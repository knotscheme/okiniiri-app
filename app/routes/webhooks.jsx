import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Resend } from "resend";

// プラン名の定数定義（課金プラン名と一致させる）
const MONTHLY_PLAN_STANDARD = "Standard Plan";
const MONTHLY_PLAN_PRO = "Pro Plan";

export const action = async ({ request }) => {
  // 1. Webhookの認証
  const { topic, shop, payload, admin } = await authenticate.webhook(request);

  if (!admin && topic !== "SHOP_REDACT") {
    return new Response();
  }

  switch (topic) {
    // ================================================================
    // 【保護】コンバージョン計測 (注文作成時)
    // ================================================================
    case "orders/create":
    case "ORDERS_CREATE":
      try {
        const order = payload;
        const email = order.email || order.contact_email;
        const lineItems = order.line_items || [];

        if (email && lineItems.length > 0) {
          for (const item of lineItems) {
            const variantIdString = item.variant_id ? String(item.variant_id) : null;
            if (variantIdString) {
              // 購入された商品が入荷通知待ちリストにあれば、コンバージョンとして記録
              await db.restockRequest.updateMany({
                where: { shop, customerEmail: email, variantId: variantIdString, isConverted: false },
                data: { isConverted: true, convertedAt: new Date(), convertedPrice: parseFloat(item.price) }
              });
            }
          }
        }
      } catch (error) {
        console.error("Error processing ORDERS_CREATE:", error);
      }
      break;

    // ================================================================
    // 【核心】在庫復活通知 (多言語対応 + プラン制限 + 自動リセット)
    // ================================================================
    case "inventory_levels/update":
    case "INVENTORY_LEVELS_UPDATE":
      try {
        const inventoryItemId = payload.inventory_item_id;
        const available = payload.available;

        // 在庫が0より大きくなった場合のみ処理
        if (available > 0 && inventoryItemId) {
          const response = await admin.graphql(
            `#graphql
            query getProductByInventoryItem($id: ID!) {
              inventoryItem(id: $id) {
                variant { id product { handle, title } }
              }
            }`,
            { variables: { id: `gid://shopify/InventoryItem/${inventoryItemId}` } }
          );

          const result = await response.json();
          const variantData = result.data?.inventoryItem?.variant;
          if (!variantData) break;

          const productData = variantData.product;
          const { handle, title } = productData;
          const variantId = variantData.id.split("/").pop();

          // 🌟 通知待ちユーザー（isNotified: false）のみを抽出
          const requests = await db.restockRequest.findMany({
            where: { shop, variantId: variantId, isNotified: false }
          });
          
          if (requests.length === 0) break;

          // --- 利用状況の取得と月次リセット ---
          let usage = await db.appUsage.upsert({
            where: { shop }, update: {}, create: { shop, sentCount: 0 }
          });

          const now = new Date();
          const lastReset = new Date(usage.lastReset || 0);
          if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
            usage = await db.appUsage.update({
              where: { shop }, data: { sentCount: 0, lastReset: now }
            });
          }
          
          let currentSentCount = usage.sentCount;

          // --- プランに応じた送信上限の決定 ---
          let emailLimit = 50; 
          try {
            const subQuery = await admin.graphql(`
              query {
                currentAppInstallation { activeSubscriptions { name } }
              }
            `);
            const subJson = await subQuery.json();
            const subs = subJson.data?.currentAppInstallation?.activeSubscriptions || [];
            if (subs.some(s => s.name === MONTHLY_PLAN_STANDARD || s.name === MONTHLY_PLAN_PRO)) {
              emailLimit = 10000;
            }
          } catch (subErr) { console.error("Plan check failed in webhook:", subErr); }

          // --- メール設定と多言語ロジックの取得 ---
          const settings = await db.emailSetting.findFirst({ where: { shop } });
          if (settings && settings.isRestockEnabled === false) break;

          const lang = settings?.language || "ja";
          const senderName = settings?.senderName || "ショップ事務局";
          let subjectTemplate = settings?.restockSubject || `【再入荷】${title} が入荷しました！`;
          let bodyTemplate = settings?.restockBody || `<p>お待たせしました！</p><p>商品「<strong>${title}</strong>」が入荷しました。</p>`;

          // 自動翻訳（設定がデフォルトの場合のみ）
          if (lang !== "ja" && (!settings?.restockSubject || settings.restockSubject.includes("【再入荷】"))) {
            const translations = {
              en: { sub: `[Restock Alert] ${title} is back!`, body: `<p>Good news!</p><p>"<strong>${title}</strong>" is back in stock.</p>` },
              "zh-TW": { sub: `【到貨通知】${title} 已經補貨了！`, body: `<p>您好！</p><p>您訂閱的商品「<strong>${title}</strong>」已經重新上架。</p>` },
              fr: { sub: `[Alerte Stock] ${title} est disponible !`, body: `<p>L'article "<strong>${title}</strong>" est de nouveau en stock.</p>` },
              de: { sub: `[Wunschliste] ${title} ist wieder da!`, body: `<p>Der Artikel "<strong>${title}</strong>" ist wieder verfügbar.</p>` },
              es: { sub: `[Stock] ¡${title} ya está disponible!`, body: `<p>El artículo "<strong>${title}</strong>" vuelve a estar disponible.</p>` }
            };
            if (translations[lang]) {
              subjectTemplate = translations[lang].sub;
              bodyTemplate = translations[lang].body;
            }
          }

          // --- メール一括送信 (Resend) ---
          const resendApiKey = process.env.RESEND_API_KEY;
          if (resendApiKey && requests.length > 0) {
            const resend = new Resend(resendApiKey);

            for (const req of requests) {
              // 上限チェック
              if (currentSentCount >= emailLimit) {
                console.warn(`[LIMIT REACHED] Shop ${shop} reached the limit.`);
                break;
              }

              try {
                // 送信元を in_stock@knotscheme.com に固定
                await resend.emails.send({
                  from: `${senderName} <in_stock@knotscheme.com>`,
                  to: req.customerEmail,
                  subject: subjectTemplate.replace(/{{product_name}}/g, title),
                  html: `
                    ${bodyTemplate.replace(/{{product_name}}/g, title)}
                    <p><a href="https://${shop}/products/${handle}">
                      ${lang === 'ja' ? '商品ページへ' : 'View Product'}
                    </a></p>
                  `
                });

                // 🌟 【超重要：リセット処理】
                // 通知済み(isNotified: true)に更新することで、次回の登録を「新規」として扱えるようにする
                await db.restockRequest.update({ 
                  where: { id: req.id }, 
                  data: { isNotified: true, notifiedAt: new Date() } 
                });
                
                // 送信履歴の作成
                await db.notification.create({
                  data: { productHandle: handle, customerEmail: req.customerEmail }
                });

                currentSentCount++;
                // カウントをDBに保存
                await db.appUsage.update({
                  where: { shop },
                  data: { sentCount: currentSentCount }
                });

              } catch (sendError) {
                console.error(`Mail Send Error (${req.customerEmail}):`, sendError);
              }
            }
          }
        }
      } catch (error) {
        console.error("Error processing INVENTORY_LEVELS_UPDATE:", error);
      }
      break;

    case "APP_UNINSTALLED":
      if (shop) await db.session.deleteMany({ where: { shop } });
      break;

    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
    case "SHOP_REDACT":
      return new Response();

    default:
      return new Response("Unhandled webhook topic", { status: 404 });
  }

  return new Response();
};