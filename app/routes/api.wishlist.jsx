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
    // 2. 認証
    const { admin, session } = await authenticate.public.appProxy(request);
    if (!admin) return customJson({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(request.url);
    const shopDomain = session?.shop || url.searchParams.get("shop");

    // 3. データ受け取り
    const body = await request.json().catch(() => ({}));
    const { customerId, productHandle, mode, referrer } = body;

    if (!customerId || !productHandle) {
      return customJson({ error: "Missing data" }, { status: 400 });
    }

    let newList = [];
    let actionType = 'kept';

    // 🌟 IDが "guest" から始まるかで判定（guest_12345 等にも対応）
    const isGuest = String(customerId).startsWith("guest");

    // =========================================================================
    // ShopifyのMetafield（顧客データ）への保存処理
    // =========================================================================
    if (!isGuest) {
      const customerQuery = await admin.graphql(
        `query getCustomer($id: ID!) {
          customer(id: $id) { metafield(namespace: "custom", key: "wishlist") { value } }
        }`,
        { variables: { id: `gid://shopify/Customer/${customerId}` } }
      );

      const customerData = await customerQuery.json();
      const currentValue = customerData.data?.customer?.metafield?.value;
      
      if (currentValue) {
        try {
          newList = JSON.parse(currentValue);
          if (!Array.isArray(newList)) newList = [];
        } catch (e) { newList = []; }
      }

      // 🌟 フロントからの指示(add/delete/toggle)を正確に処理する安全なロジック
      if (mode === 'delete') {
        newList = newList.filter(handle => handle !== productHandle);
        actionType = 'removed';
      } else if (mode === 'add') {
        if (!newList.includes(productHandle)) newList.push(productHandle);
        actionType = 'added';
      } else {
        // mode指定がない場合（元のtoggle動作のフェイルセーフ）
        if (newList.includes(productHandle)) {
          newList = newList.filter(handle => handle !== productHandle);
          actionType = 'removed';
        } else {
          newList.push(productHandle);
          actionType = 'added';
        }
      }

      const saveMutation = await admin.graphql(
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

      const userErrors = (await saveMutation.json()).data?.customerUpdate?.userErrors;
      if (userErrors && userErrors.length > 0) {
        return customJson({ error: "Save failed", details: userErrors }, { status: 500 });
      }
    } else {
      // ゲストの場合はフロントエンドの明確な指示に従う
      actionType = (mode === 'delete') ? 'removed' : 'added';
    }


    // =========================================================================
    // ▼▼▼ Prisma連携（ダッシュボード分析用） ▼▼▼
    // =========================================================================
    if (shopDomain) {
      try {
        if (actionType === 'added') {
          const existing = await prisma.favorite.findFirst({
            where: { 
              shop: shopDomain,
              customerId: String(customerId), // 会員IDまたはゲストID
              productHandle: String(productHandle) 
            }
          });

          if (!existing) {
            // Shopifyから商品の詳細（タイトルや画像）を取得（元のコード完全復元！）
            let productTitle = productHandle;
            let productImageUrl = "";
            try {
               const productQuery = await admin.graphql(
                `query getProductDetails($handle: String!) {
                  productByHandle(handle: $handle) { title featuredImage { url } }
                }`,
                { variables: { handle: productHandle } }
              );
              const productData = await productQuery.json();
              if (productData.data?.productByHandle) {
                  productTitle = productData.data.productByHandle.title;
                  productImageUrl = productData.data.productByHandle.featuredImage?.url || "";
              }
            } catch (graphqlErr) {
               console.error("⚠️ [GraphQL] Product details fetch failed:", graphqlErr);
            }

            // Prismaへ保存
            await prisma.favorite.create({
              data: { 
                shop: shopDomain,
                customerId: String(customerId), 
                productHandle: String(productHandle)
                // referrer: String(referrer || "Direct") // DBにreferrerカラムがある場合のみ有効化
              }
            });
          }
        } else if (actionType === 'removed') {
          // 🌟 ゲストがお気に入り解除した時も、ダッシュボードの数字を正確に減らすためにDBから削除
          await prisma.favorite.deleteMany({
            where: { 
              shop: shopDomain,
              customerId: String(customerId), 
              productHandle: String(productHandle) 
            }
          });
        }
      } catch (dbError) {
        console.error("⚠️ [DB] Prisma連携エラー:", dbError.message);
      }
    }
    // =========================================================================

    return customJson({ success: true, list: newList, action: actionType });

  } catch (err) {
    return customJson({ error: "Server Error", details: err.message }, { status: 500 });
  }
};

export const loader = async () => customJson({ status: "ok" });