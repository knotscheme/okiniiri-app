import { authenticate } from "../shopify.server";
import prisma from "../db.server"; 

// ★自作レスポンス関数 (CORS対応・エラー回避)
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
    const { customerId, productHandle, mode, referrer } = body;

    // 🌟 修正：productHandleさえあれば処理を続行（customerIdが空でもゲストとして扱う）
    if (!productHandle) {
      return customJson({ error: "Missing product handle" }, { status: 400 });
    }

    let newList = [];
    let actionType = 'added';

    // 🌟 判定強化：IDが空、"null"、または "guest" で始まる場合は全て「ゲスト」
    const isGuest = !customerId || customerId === "null" || String(customerId).startsWith("guest");

    // =========================================================================
    // 1. Shopify会員データ（Metafield）への保存
    // =========================================================================
    if (!isGuest) {
      try {
        // 会員の場合のみShopifyのデータを読み書き
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
          newList = newList.filter(handle => handle !== productHandle);
          actionType = 'removed';
        } else if (mode === 'add') {
          if (!newList.includes(productHandle)) newList.push(productHandle);
          actionType = 'added';
        } else {
          // toggle動作
          if (newList.includes(productHandle)) {
            newList = newList.filter(handle => handle !== productHandle);
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
        // 🌟 会員処理でエラーが出ても、分析DB保存（Prisma）は止めないようにガード
        console.error("⚠️ Shopify Metafield Error:", shopifyErr.message);
      }
    } else {
      // ゲストの場合は指示通りにアクションを決定
      actionType = (mode === 'delete') ? 'removed' : 'added';
    }

    // =========================================================================
    // 2. Prisma連携（ダッシュボード分析用）
    // =========================================================================
    if (shopDomain) {
      try {
        // ゲストIDが空の場合は "guest_anonymous" として保存
        const finalCustomerId = isGuest ? (customerId || "guest_anonymous") : String(customerId);

        if (actionType === 'added') {
          const existing = await prisma.favorite.findFirst({
            where: { shop: shopDomain, customerId: finalCustomerId, productHandle: String(productHandle) }
          });

          if (!existing) {
            // 商品情報を取得（ここも個別にtry-catchして安全に）
            let productTitle = productHandle;
            try {
               const productQuery = await admin.graphql(
                `query getP($h: String!) { productByHandle(handle: $h) { title } }`,
                { variables: { h: productHandle } }
              );
              const productData = await productQuery.json();
              productTitle = productData.data?.productByHandle?.title || productHandle;
            } catch (e) {}

            await prisma.favorite.create({
              data: { 
                shop: shopDomain,
                customerId: finalCustomerId, 
                productHandle: String(productHandle)
              }
            });
          }
        } else if (actionType === 'removed') {
          await prisma.favorite.deleteMany({
            where: { shop: shopDomain, customerId: finalCustomerId, productHandle: String(productHandle) }
          });
        }
      } catch (dbError) {
        console.error("⚠️ Prisma/DB Error:", dbError.message);
      }
    }

    return customJson({ success: true, list: newList, action: actionType });

  } catch (err) {
    console.error("❌ Critical API Error:", err);
    return customJson({ error: "Server Error" }, { status: 500 });
  }
};

export const loader = async () => customJson({ status: "ok" });