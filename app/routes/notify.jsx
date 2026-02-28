import { authenticate } from "../shopify.server";
import { Resend } from "resend";
import db from "../db.server";

// プラン名の定数定義（課金プラン名と一致させる）
const MONTHLY_PLAN_STANDARD = "Standard Plan";
const MONTHLY_PLAN_PRO = "Pro Plan";

// ★CORS許可証付きの自作json関数 (現状維持・保護)
const json = (data, init = {}) => {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...init.headers,
    },
  });
};

export const action = async ({ request }) => {
  try {
    // 1. セキュリティ認証
    const { session } = await authenticate.public.appProxy(request);
    
    // 2. データの取得
    const data = await request.json().catch(() => ({}));
    const { productHandle, variantId, customerEmail, actionType, referrer } = data;

    const url = new URL(request.url);
    const shop = session?.shop || url.searchParams.get("shop") || data.shop;

    if (!shop) {
      return json({ status: "error", message: "Unauthorized: Missing shop" }, { status: 401 });
    }

    const safeReferrer = referrer || "";
    const safeVariantId = variantId ? String(variantId) : "";

    // --- 【削除処理】 (完全維持・保護) ---
    if (actionType === 'delete') {
      try {
        await db.restockRequest.deleteMany({
          where: { shop, productHandle, variantId: safeVariantId, customerEmail }
        });
        return json({ success: true }, { status: 200 });
      } catch(e) {
        console.error("Notify Delete DB Error:", e);
        return json({ error: "Delete failed" }, { status: 500 });
      }
    }

    // --- 【登録処理】 (完全維持・保護) ---
    // ※ストッパーよりも先に実行されるため、メールが上限で止まっても登録は絶対に成功します。
    try {
      const existing = await db.restockRequest.findFirst({
        where: { shop, productHandle, variantId: safeVariantId, customerEmail }
      });
      if (!existing) {
        await db.restockRequest.create({
          data: { shop, productHandle, variantId: safeVariantId, customerEmail, referrer: safeReferrer }
        });
      }
    } catch(dbError) {
      console.error("Notify Create DB Error:", dbError);
    }

    // ==========================================================
    // ★ 追加：利用状況の取得と月次リセット処理（安全保護付き）
    // ==========================================================
    let usage;
    try {
      usage = await db.appUsage.upsert({
        where: { shop },
        update: {},
        create: { shop, sentCount: 0 }
      });

      const now = new Date();
      const lastReset = new Date(usage.lastReset);
      
      if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
        usage = await db.appUsage.update({
          where: { shop },
          data: { sentCount: 0, lastReset: now }
        });
      }
    } catch (dbError) {
       console.error("Failed to fetch/update app usage:", dbError);
       usage = { sentCount: 0 }; // エラー時は0通として安全にスルー
    }
    
    let currentSentCount = usage.sentCount;

    // ==========================================================
    // ★ 追加：現在のプランを取得し送信上限を決定（安全保護付き）
    // ==========================================================
    let emailLimit = 50; // デフォルトはFreeプラン
    
    try {
      const offlineSession = await db.session.findFirst({
        where: { shop, isOnline: false }
      });

      if (offlineSession && offlineSession.accessToken) {
        // Shopify API (2024-10) を使用して安全にプラン情報を取得
        const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': offlineSession.accessToken,
          },
          body: JSON.stringify({
            query: `
              query {
                currentAppInstallation {
                  activeSubscriptions { name }
                }
              }
            `
          })
        });

        const subJson = await response.json();
        const subs = subJson.data?.currentAppInstallation?.activeSubscriptions || [];
        
        const hasPaidPlan = subs.some(s => s.name === MONTHLY_PLAN_STANDARD || s.name === MONTHLY_PLAN_PRO);
        if (hasPaidPlan) {
          emailLimit = 10000;
        }
      }
    } catch (subErr) {
      console.error("Plan check failed in notify.jsx:", subErr);
      // エラー時はデフォルトの50通のまま安全に続行
    }

    // --- 【メール送信処理】 (★上限チェックを追加) ---
    if (process.env.RESEND_API_KEY) {
      
      // ==========================================================
      // ★ 追加：上限に達していたらメールは送らずに成功レスポンスを返す
      // ==========================================================
      if (currentSentCount >= emailLimit) {
         console.warn(`[LIMIT REACHED] Shop ${shop} reached the limit of ${emailLimit} emails. Skip sending confirm email.`);
         return json({ success: true }, { status: 200 });
      }

      const resend = new Resend(process.env.RESEND_API_KEY);
      
      // デフォルト設定 (日本語)
      let senderName = "ショップ事務局";
      let subject = "【再入荷通知登録完了】";
      let bodyTemplate = `商品「{{product_name}}」の入荷通知設定を承りました。入荷次第、本メールアドレスへご連絡いたします。`;
      let lang = "ja";

      try {
        const settings = await db.emailSetting.findFirst({ where: { shop } });
        
        if (settings) {
          lang = settings.language || "ja";
          
          senderName = settings.senderName || senderName;
          subject = settings.subject || subject;
          bodyTemplate = settings.body || bodyTemplate;

          // ★翻訳リスト（元コードを完全維持）
          if (lang !== "ja" && settings.subject === "【再入荷通知登録完了】") {
            const translations = {
              en: { sub: "[Subscription Confirmed] Restock Alert", body: 'We have received your request for "{{product_name}}". We will notify you once it arrives.' },
              "zh-TW": { sub: "【到貨通知登記成功】", body: '我們已收到您對「{{product_name}}」的到貨通知請求。商品到貨後，我們將立即通知您。' },
              fr: { sub: "[Confirmation] Alerte de réapprovisionnement", body: 'Nous avons bien reçu votre demande pour "{{product_name}}". Nous vous préviendrons dès son arrivée.' },
              de: { sub: "[Bestätigung] Benachrichtigung bei Verfügbarkeit", body: 'Wir haben Ihre Anfrage für "{{product_name}}" erhalten. Wir informieren Sie, sobald der Artikel verfügbar ist.' },
              es: { sub: "[Confirmación] Alerta de reposición", body: 'Hemos recibido su solicitud para "{{product_name}}". Le avisaremos en cuanto esté disponible.' }
            };

            if (translations[lang]) {
              subject = translations[lang].sub;
              bodyTemplate = translations[lang].body;
            }
          }
        }
      } catch (e) {
        console.error("Settings fetch error:", e);
      }

      try {
        // メールの送信
        await resend.emails.send({
          from: `${senderName} <in_stock@knotscheme.com>`, 
          to: customerEmail, 
          subject: subject.replace(/{{product_name}}/g, productHandle),
          html: `<p>${bodyTemplate.replace(/{{product_name}}/g, productHandle)}</p>`
        });

        // ==========================================================
        // ★ 追加：送信成功したらカウントアップしてDB保存
        // ==========================================================
        currentSentCount++;
        try {
          await db.appUsage.update({
            where: { shop },
            data: { sentCount: currentSentCount }
          });
        } catch (updateErr) {
           console.error("Failed to update sentCount in notify.jsx:", updateErr);
        }

      } catch (mailError) {
        console.error("⚠️ Resend送信失敗:", mailError);
      }
    }

    return json({ success: true }, { status: 200 });

  } catch (err) {
    console.error("❌ notify.jsx Action Error:", err);
    return json({ error: "Server Error", detail: err.message }, { status: 500 });
  }
};