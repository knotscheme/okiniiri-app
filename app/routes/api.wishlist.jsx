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

    let newList = [];
    let actionType = 'added';

    // 🌟 最強のゲスト判定：IDが「空」「null文字」「guestで始まる」のどれかならゲスト！
    const isGuest = !customerId || customerId === "" || customerId === "null" || String(customerId).startsWith("guest");

    // =========================================================================
    // 1. Shopify会員データ（Metafield）への保存
    // =========================================================================
    if (!isGuest) {
      try {
        console.log("👤 会員として処理中... ID:", customerId);
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
        if (!Array.isArray(newList)) newList = [];

        if (mode === 'delete') {
          newList = newList.filter(h => h !== productHandle);
          actionType = 'removed';
        } else {
          if (newList.includes(productHandle)) {
            newList = newList.filter(h => h !== productHandle);
            actionType = 'removed';
          } else {
            newList.push(productHandle);
            actionType = 'added';
          }
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
      } catch (shopifyErr) {
        console.error("⚠️ Shopify Metafield Error (Skipping):", shopifyErr.message);
      }
    } else {
      // 🌟 ゲストの場合
      console.log("🤖 ゲストとして処理中...");
      actionType = (mode === 'delete') ? 'removed' : 'added';
    }

    // =========================================================================
    // 2. Prisma連携（分析DB）
    // =========================================================================
    if (shopDomain) {
      try {
        // IDが空の場合は一時的な匿名IDを付与
        const dbId = isGuest ? (customerId || "guest_anonymous") : String(customerId);

        if (actionType === 'added') {
          const existing = await prisma.favorite.findFirst({
            where: { shop: shopDomain, customerId: dbId, productHandle: String(productHandle) }
          });

          if (!existing) {
            await prisma.favorite.create({
              data: { 
                shop: shopDomain,
                customerId: dbId, 
                productHandle: String(productHandle)
              }
            });
            console.log("✅ [DB] 保存成功！:", productHandle);
          }
        } else {
          await prisma.favorite.deleteMany({
            where: { shop: shopDomain, customerId: dbId, productHandle: String(productHandle) }
          });
          console.log("✅ [DB] 削除成功！:", productHandle);
        }
      } catch (dbError) {
        console.error("⚠️ Prisma Error:", dbError.message);
      }
    }

    return customJson({ success: true, list: newList, action: actionType });

  } catch (err) {
    console.error("❌ Critical API Error:", err);
    return customJson({ error: "Server Error" }, { status: 500 });
  }
};

export const loader = async () => customJson({ status: "ok" });