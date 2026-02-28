import { authenticate } from "../shopify.server";
import { Resend } from "resend";
import db from "../db.server";
console.log("🚀 [VERIFY] 最新の notify.jsx が起動しました！");

const MONTHLY_PLAN_STANDARD = "Standard Plan";
const MONTHLY_PLAN_PRO = "Pro Plan";

// JSONレスポンス用ヘルパー（CORS/App Proxy対応）
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
    const { productHandle, variantId, customerEmail, actionType } = data;
    const url = new URL(request.url);
    const shop = session?.shop || url.searchParams.get("shop") || data.shop;

    if (!shop) return json({ error: "Unauthorized" }, { status: 401 });

    const safeVariantId = variantId ? String(variantId) : "";

    // --- 【ステータス管理：1-2-3サイクルの判定】 ---
    // 「通知待ち (isNotified: false)」の既存データがあるか確認
    const existing = await db.restockRequest.findFirst({
      where: { 
        shop, 
        variantId: safeVariantId, 
        customerEmail,
        isNotified: false // 在庫追加で通知済みのものは除外（＝これでリセットが実現）
      }
    });

    // --- 【手順2：解除処理】 ---
    if (actionType === 'delete') {
      if (existing) {
        // 物理削除せず「解除済み」の目印をつける
        await db.restockRequest.update({
          where: { id: existing.id },
          data: { referrer: "UNSUBSCRIBED" }
        });
      }
      return json({ success: true });
    }

    // --- 【手順1 & 3：登録処理】 ---
    let shouldSendConfirmEmail = false;

    if (!existing) {
      // 🌟【手順1】全くの新規、または在庫復活通知が完了した後の「再登録」
      await db.restockRequest.create({
        data: { shop, productHandle, variantId: safeVariantId, customerEmail, isNotified: false, referrer: "" }
      });
      shouldSendConfirmEmail = true; // 初回（またはリセット後）なのでメール送る
    } else if (existing.referrer === "UNSUBSCRIBED") {
      // 🌟【手順3】解除中だった人の「復活登録」
      await db.restockRequest.update({
        where: { id: existing.id },
        data: { referrer: "" } // 目印を消して有効化
      });
      shouldSendConfirmEmail = false; // ★解除からの再登録なのでメールは送らない
    } else {
      // すでに登録済みで有効な場合は何もしない
      return json({ success: true });
    }

    // ==========================================================
    // 🌟 ユーザーを待たせずに裏側（バックグラウンド）でメール送信
    // ==========================================================
    (async () => {
      try {
        if (!shouldSendConfirmEmail || !process.env.RESEND_API_KEY) return;

        // --- プラン＆上限チェック (バックグラウンドで安全に実行) ---
        let usage = await db.appUsage.upsert({
          where: { shop }, update: {}, create: { shop, sentCount: 0 }
        });

        // 月次リセット処理
        const now = new Date();
        const lastReset = new Date(usage.lastReset || 0);
        if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
          usage = await db.appUsage.update({ where: { shop }, data: { sentCount: 0, lastReset: now } });
        }

        // Shopify GraphQLでプラン確認
        let emailLimit = 50; 
        const offlineSession = await db.session.findFirst({ where: { shop, isOnline: false } });
        if (offlineSession?.accessToken) {
          try {
            const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': offlineSession.accessToken },
              body: JSON.stringify({ query: `query { currentAppInstallation { activeSubscriptions { name } } }` })
            });
            const subJson = await response.json();
            const subs = subJson.data?.currentAppInstallation?.activeSubscriptions || [];
            if (subs.some(s => s.name === MONTHLY_PLAN_STANDARD || s.name === MONTHLY_PLAN_PRO)) emailLimit = 10000;
          } catch (e) { console.error("Plan check fetch failed:", e); }
        }

        // 送信処理
        if (usage.sentCount < emailLimit) {
          const resend = new Resend(process.env.RESEND_API_KEY);
          const settings = await db.emailSetting.findFirst({ where: { shop } });
          
          let lang = settings?.language || "ja";
          let senderName = settings?.senderName || "ショップ事務局";
          let subject = settings?.subject || "【再入荷通知登録完了】";
          let bodyTemplate = settings?.body || `商品「{{product_name}}」の入荷通知設定を承りました。入荷次第、ご連絡いたします。`;

          // 多言語対応 (未設定時のみ自動翻訳)
          if (lang !== "ja" && (!settings?.subject || settings.subject === "【再入荷通知登録完了】")) {
            const translations = {
              en: { sub: "[Confirmation] Restock Alert Set", body: 'We have received your request for "{{product_name}}". We will notify you once it arrives.' },
              "zh-TW": { sub: "【到貨通知登記成功】", body: '我們已收到您對「{{product_name}}」的到貨通知請求。商品到貨後，我們將立即通知您。' }
            };
            if (translations[lang]) { subject = translations[lang].sub; bodyTemplate = translations[lang].body; }
          }

          // メールの送信 (送信元を in_stock@knotscheme.com に固定)
          await resend.emails.send({
            from: `${senderName} <in_stock@knotscheme.com>`, 
            to: customerEmail, 
            subject: subject.replace(/{{product_name}}/g, productHandle),
            html: `<p>${bodyTemplate.replace(/{{product_name}}/g, productHandle)}</p>`
          });

          // 送信カウントを更新
          await db.appUsage.update({ where: { shop }, data: { sentCount: { increment: 1 } } });
        }
      } catch (bgError) {
        console.error("❌ Background notify error (Resend or DB):", bgError);
      }
    })();

    // 🌟 登録・解除の完了を即座にブラウザへ返信 (これが爆速ボタンのキモ)
    return json({ success: true });

  } catch (err) {
    console.error("❌ notify.jsx Action Error:", err);
    return json({ error: "Server Error" }, { status: 500 });
  }
};