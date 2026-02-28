import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Resend } from "resend";

// プラン名の定数定義（課金プラン名と一致させる）
const MONTHLY_PLAN_STANDARD = "Standard Plan";
const MONTHLY_PLAN_PRO = "Pro Plan";

export const action = async ({ request }) => {
  const { topic, shop, payload, admin } = await authenticate.webhook(request);

  if (!admin && topic !== "SHOP_REDACT") {
    return new Response();
  }

  switch (topic) {
    // ================================================================
    // 【保護】コンバージョン計測 (注文作成時) - 完全無変更
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
              await db.restockRequest.updateMany({
                where: { shop, customerEmail: email, variantId: variantIdString, isConverted: false },
                data: { isConverted: true, convertedAt: new Date(), convertedPrice: parseFloat(item.price) }
              });
            }
          }
        }
      } catch (error) { console.error("Error processing ORDERS_CREATE:", error); }
      break;

    // ================================================================
    // 【強化】在庫復活通知 (多言語対応 + プラン制限ストッパー)
    // ================================================================
    case "INVENTORY_LEVELS_UPDATE":
      try {
        const inventoryItemId = payload.inventory_item_id;
        const available = payload.available;

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

          // 通知待ちユーザーを抽出
          const requests = await db.restockRequest.findMany({
            where: { shop, variantId: variantId, isNotified: false }
          });
          if (requests.length === 0) break;

          // ==========================================================
          // ★ 追加：利用状況の取得と月次リセット処理（安全設計）
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
            
            // 月が変わっていればカウントをリセット
            if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
              usage = await db.appUsage.update({
                where: { shop },
                data: { sentCount: 0, lastReset: now }
              });
            }
          } catch (dbError) {
             console.error("Failed to fetch/update app usage:", dbError);
             usage = { sentCount: 0 }; // エラー時は一旦0として扱う（システムを止めない）
          }
          
          let currentSentCount = usage.sentCount;

          // ==========================================================
          // ★ 追加：現在のプランを取得し、送信上限を決定（安全設計）
          // ==========================================================
          let emailLimit = 50; // デフォルトはFreeプランの50通
          
          try {
            const subQuery = await admin.graphql(`
              query {
                currentAppInstallation {
                  activeSubscriptions { name }
                }
              }
            `);
            const subJson = await subQuery.json();
            const subs = subJson.data?.currentAppInstallation?.activeSubscriptions || [];
            
            const hasPaidPlan = subs.some(s => s.name === MONTHLY_PLAN_STANDARD || s.name === MONTHLY_PLAN_PRO);
            
            if (hasPaidPlan) {
              emailLimit = 10000; // 有料プランは1万通上限
            }
          } catch (subErr) {
            console.error("Plan check failed in webhook:", subErr);
            // エラー時はデフォルト(50)のまま安全に続行
          }

          // --- メール設定と多言語ロジック ---
          const settings = await db.emailSetting.findFirst({ where: { shop } });
          if (settings && settings.isRestockEnabled === false) break;

          const lang = settings?.language || "ja";
          let senderName = settings?.senderName || "ショップ事務局";
          
          // 基本テンプレート（日本語）
          let subjectTemplate = settings?.restockSubject || `【再入荷】${title} が入荷しました！`;
          let bodyTemplate = settings?.restockBody || `<p>お待たせしました！</p><p>商品「<strong>${title}</strong>」が入荷しました。</p>`;

          // 多言語翻訳スイッチ
          if (lang !== "ja" && (!settings?.restockSubject || settings.restockSubject.includes("【再入荷】"))) {
            const translations = {
              en: {
                sub: `[Restock Alert] ${title} is back in stock!`,
                body: `<p>Good news!</p><p>The item "<strong>${title}</strong>" you were looking for is back.</p>`
              },
              "zh-TW": {
                sub: `【到貨通知】${title} 已經補貨了！`,
                body: `<p>您好！</p><p>您訂閱的商品「<strong>${title}</strong>」已經重新上架。</p>`
              },
              fr: {
                sub: `[Alerte Stock] ${title} est de nouveau disponible !`,
                body: `<p>Bonne nouvelle !</p><p>L'article "<strong>${title}</strong>" est de nouveau en stock.</p>`
              },
              de: {
                sub: `[Wunschliste] ${title} ist wieder verfügbar!`,
                body: `<p>Gute Nachrichten!</p><p>Der Artikel "<strong>${title}</strong>" ist wieder da.</p>`
              },
              es: {
                sub: `[Aviso de Stock] ¡${title} ya está disponible!`,
                body: `<p>¡Buenas noticias!</p><p>El artículo "<strong>${title}</strong>" vuelve a estar disponible.</p>`
              }
            };

            if (translations[lang]) {
              subjectTemplate = translations[lang].sub;
              bodyTemplate = translations[lang].body;
            }
          }

          // --- メール一括送信 (Resend) ---
          const resendApiKey = process.env.RESEND_API_KEY;
          if (resendApiKey) {
            const resend = new Resend(resendApiKey);

            for (const req of requests) {
              // ==========================================================
              // ★ 追加：上限に達していたら送信をストップする（break）
              // ==========================================================
              if (currentSentCount >= emailLimit) {
                console.warn(`[LIMIT REACHED] Shop ${shop} reached the limit of ${emailLimit} emails.`);
                break; // これ以上送らない
              }

              try {
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

                // 通知済みフラグを更新
                await db.restockRequest.update({ where: { id: req.id }, data: { isNotified: true } });
                
                // 履歴作成
                await db.notification.create({
                  data: { productHandle: handle, customerEmail: req.customerEmail }
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
                   console.error("Failed to update sentCount:", updateErr);
                }

              } catch (sendError) { console.error(`Mail Error (${req.customerEmail}):`, sendError); }
            }
          }
        }
      } catch (error) { console.error("Error processing INVENTORY_LEVELS_UPDATE:", error); }
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