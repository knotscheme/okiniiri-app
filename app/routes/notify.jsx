import { authenticate } from "../shopify.server";
import { Resend } from "resend";
import db from "../db.server";

const MONTHLY_PLAN_STANDARD = "Standard Plan";
const MONTHLY_PLAN_PRO = "Pro Plan";

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
    // 1. セキュリティ認証 (App Proxy経由)
    const { session } = await authenticate.public.appProxy(request);
    
    // 2. データの取得
    const data = await request.json().catch(() => ({}));
    const { productHandle, variantId, customerEmail, actionType, referrer } = data;
    const url = new URL(request.url);
    const shop = session?.shop || url.searchParams.get("shop") || data.shop;

    if (!shop) return json({ error: "Unauthorized" }, { status: 401 });

    const safeVariantId = variantId ? String(variantId) : "";

    // --- 【ステータス管理の核心：過去の有効な登録があるか確認】 ---
    // 「通知済み(NOTIFIED)」以外のデータを検索します
    const existing = await db.restockRequest.findFirst({
      where: { 
        shop, productHandle, variantId: safeVariantId, customerEmail,
        NOT: { referrer: "NOTIFIED" } 
      }
    });

    // --- 【解除処理】 ---
    // 物理削除せず「解除中」ラベルを貼ることで、分析データを保護します
    if (actionType === 'delete') {
      if (existing) {
        await db.restockRequest.update({
          where: { id: existing.id },
          data: { referrer: "UNSUBSCRIBED" }
        });
      }
      return json({ success: true });
    }

    // --- 【登録処理】 ---
    let shouldSendConfirmEmail = false;

    if (!existing) {
      // 全くの新規、または以前の通知が「完了」している人なら新しくデータ作成
      await db.restockRequest.create({
        data: { shop, productHandle, variantId: safeVariantId, customerEmail, referrer: "" }
      });
      shouldSendConfirmEmail = true; // 新規なので確認メールを送る
    } else if (existing.referrer === "UNSUBSCRIBED") {
      // 「解除中」だった人の再登録なら、ラベルを戻すだけ
      await db.restockRequest.update({
        where: { id: existing.id },
        data: { referrer: "" }
      });
      shouldSendConfirmEmail = false; // ★ 2回目なので確認メールは送らない
    }

    // ==========================================================
    // 🌟 ここから下が「重い処理」なので、ユーザーを待たせずに裏で実行
    // ==========================================================
    (async () => {
      try {
        if (!shouldSendConfirmEmail || !process.env.RESEND_API_KEY) return;

        // 利用状況の取得と上限チェック
        let usage = await db.appUsage.upsert({
          where: { shop }, update: {}, create: { shop, sentCount: 0 }
        });

        // 月次リセット処理
        const now = new Date();
        const lastReset = new Date(usage.lastReset);
        if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
          usage = await db.appUsage.update({ where: { shop }, data: { sentCount: 0, lastReset: now } });
        }

        // プランチェック (Shopify GraphQL)
        let emailLimit = 50; 
        const offlineSession = await db.session.findFirst({ where: { shop, isOnline: false } });
        if (offlineSession?.accessToken) {
          const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': offlineSession.accessToken },
            body: JSON.stringify({ query: `query { currentAppInstallation { activeSubscriptions { name } } }` })
          });
          const subJson = await response.json();
          const subs = subJson.data?.currentAppInstallation?.activeSubscriptions || [];
          if (subs.some(s => s.name === MONTHLY_PLAN_STANDARD || s.name === MONTHLY_PLAN_PRO)) emailLimit = 10000;
        }

        // 上限に達していなければメール送信
        if (usage.sentCount < emailLimit) {
          const resend = new Resend(process.env.RESEND_API_KEY);
          let senderName = "ショップ事務局", subject = "【再入荷通知登録完了】", lang = "ja";
          let bodyTemplate = `商品「{{product_name}}」の入荷通知設定を承りました。入荷次第、本メールアドレスへご連絡いたします。`;

          const settings = await db.emailSetting.findFirst({ where: { shop } });
          if (settings) {
            lang = settings.language || "ja";
            senderName = settings.senderName || senderName;
            subject = settings.subject || subject;
            bodyTemplate = settings.body || bodyTemplate;

            if (lang !== "ja" && settings.subject === "【再入荷通知登録完了】") {
              const translations = {
                en: { sub: "[Subscription Confirmed] Restock Alert", body: 'We have received your request for "{{product_name}}". We will notify you once it arrives.' },
                "zh-TW": { sub: "【到貨通知登記成功】", body: '我們已收到您對「{{product_name}}」的到貨通知請求。商品到貨後，我們將立即通知您。' },
                fr: { sub: "[Confirmation] Alerte de réapprovisionnement", body: 'Nous avons bien reçu votre demande pour "{{product_name}}". Nous vous préviendrons dès son arrivée.' },
                de: { sub: "[Bestätigung] Benachrichtigung bei Verfügbarkeit", body: 'Wir haben Ihre Anfrage für "{{product_name}}" erhalten. Wir informieren Sie, sobald der Artikel verfügbar ist.' },
                es: { sub: "[Confirmación] Alerta de reposición", body: 'Hemos recibido su solicitud para "{{product_name}}". Le avisaremos en cuanto esté disponible.' }
              };
              if (translations[lang]) { subject = translations[lang].sub; bodyTemplate = translations[lang].body; }
            }
          }

          await resend.emails.send({
            from: `${senderName} <in_stock@knotscheme.com>`, 
            to: customerEmail, 
            subject: subject.replace(/{{product_name}}/g, productHandle),
            html: `<p>${bodyTemplate.replace(/{{product_name}}/g, productHandle)}</p>`
          });

          await db.appUsage.update({ where: { shop }, data: { sentCount: { increment: 1 } } });
        }
      } catch (bgError) { console.error("Background notify error:", bgError); }
    })();

    // 🌟 ユーザーには待たせずに「成功」を即座に返す！
    return json({ success: true });

  } catch (err) {
    console.error("❌ notify.jsx Action Error:", err);
    return json({ error: "Server Error" }, { status: 500 });
  }
};