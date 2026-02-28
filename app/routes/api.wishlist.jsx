import { authenticate } from "../shopify.server";
import prisma from "../db.server"; 

const customJson = (data, init = {}) => {
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
  if (request.method === "OPTIONS") return customJson({ ok: true });

  try {
    const { admin, session } = await authenticate.public.appProxy(request);
    if (!admin) return customJson({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(request.url);
    const shopDomain = session?.shop || url.searchParams.get("shop");

    const body = await request.json().catch(() => ({}));
    const { customerId, productHandle, mode } = body;

    if (!productHandle) return customJson({ error: "Missing handle" }, { status: 400 });

    // 🌟 ログで何が届いているか監視（デバッグ用）
    console.log(`🔹 受信データ - ID: "${customerId}", Handle: ${productHandle}, Mode: ${mode}`);

    // 🌟 【超・厳重判定】IDが空、null、undefined、または "guest" で始まれば100%ゲスト
    const isGuest = !customerId || 
                    customerId === "" || 
                    customerId === "null" || 
                    customerId === "undefined" || 
                    String(customerId).startsWith("guest");

    let actionType = (mode === 'delete') ? 'removed' : 'added';
    let newList = [];

    // =========================================================================
    // 1. Prisma連携（分析DB）を「先」にやる！
    // =========================================================================
    if (shopDomain) {
      try {
        const dbId = isGuest ? (customerId || "guest_anonymous") : String(customerId);
        if (actionType === 'added') {
          const existing = await prisma.favorite.findFirst({
            where: { shop: shopDomain, customerId: dbId, productHandle: String(productHandle) }
          });
          if (!existing) {
            await prisma.favorite.create({
              data: { shop: shopDomain, customerId: dbId, productHandle: String(productHandle) }
            });
            console.log("✅ [DB] 分析保存に成功！");
          }
        } else {
          await prisma.favorite.deleteMany({
            where: { shop: shopDomain, customerId: dbId, productHandle: String(productHandle) }
          });
          console.log("✅ [DB] 分析から削除成功！");
        }
      } catch (dbErr) {
        console.error("⚠️ [DB] Prisma Error (Skipped):", dbErr.message);
      }
    }

    // =========================================================================
    // 2. Shopify会員データ（Metafield）への保存は「後」で、かつエラーを隔離！
    // =========================================================================
    if (!isGuest && customerId) {
      try {
        console.log("👤 会員としてShopifyに保存を試みます...");
        const customerQuery = await admin.graphql(
          `query getCustomer($id: ID!) {
            customer(id: $id) { metafield(namespace: "custom", key: "wishlist") { value } }
          }`,
          { variables: { id: `gid://shopify/Customer/${customerId}` } }
        );
        const customerData = await customerQuery.json();
        const currentValue = customerData.data?.customer?.metafield?.value;
        if (currentValue) {
          try { newList = JSON.parse(currentValue); } catch (e) { newList = []; }
        }
        
        // リスト更新ロジック（会員用）
        if (mode === 'delete') {
          newList = newList.filter(h => h !== productHandle);
        } else {
          if (!newList.includes(productHandle)) newList.push(productHandle);
        }

        await admin.graphql(
          `mutation customerUpdate($input: CustomerInput!) {
            customerUpdate(input: $input) { userErrors { field message } }
          }`,
          {
            variables: {
              input: {
                id: `gid://shopify/Customer/${customerId}`,
                metafields: [{ namespace: "custom", key: "wishlist", value: JSON.stringify(newList), type: "json" }]
              }
            }
          }
        );
        console.log("✅ [Shopify] 会員メタフィールド更新成功");
      } catch (shopifyErr) {
        // ここでエラーが出ても、Prismaが成功していれば数字は増えます！
        console.error("⚠️ [Shopify] Metafield Error (Ignore):", shopifyErr.message);
      }
    }

    return customJson({ success: true, action: actionType });

  } catch (err) {
    console.error("❌ [API] Critical Error:", err);
    return customJson({ error: "Server Error" }, { status: 500 });
  }
};

export const loader = async () => customJson({ status: "ok" });