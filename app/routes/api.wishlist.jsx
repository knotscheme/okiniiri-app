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
  console.log("🔹 [API] Wishlist action called");

  if (request.method === "OPTIONS") {
    return customJson({ ok: true });
  }

  try {
    // 2. 認証
    const { admin, session } = await authenticate.public.appProxy(request);
    if (!admin) {
      console.error("❌ [API] Auth failed: No admin access");
      return customJson({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const shopDomain = session?.shop || url.searchParams.get("shop");
    console.log("🔹 [API] Shop Domain:", shopDomain);

    // 3. データ受け取り（🌟 referrer を追加）
    const body = await request.json().catch(() => ({}));
    const { customerId, productHandle, mode, referrer } = body;

    if (!customerId || !productHandle) {
      console.error("❌ [API] Missing params:", { customerId, productHandle });
      return customJson({ error: "Missing data" }, { status: 400 });
    }

    let newList = [];
    let actionType = 'kept';

    // =========================================================================
    // 4〜6. ShopifyのMetafield（顧客データ）への保存処理
    // （🌟 会員ログインしている時のみ実行するようガードを追加）
    // =========================================================================
    if (customerId !== "guest") {
      const customerQuery = await admin.graphql(
        `query getCustomer($id: ID!) {
          customer(id: $id) {
            metafield(namespace: "custom", key: "wishlist") {
              value
            }
          }
        }`,
        { variables: { id: `gid://shopify/Customer/${customerId}` } }
      );

      const customerData = await customerQuery.json();
      const currentValue = customerData.data?.customer?.metafield?.value;
      
      if (currentValue) {
        try {
          newList = JSON.parse(currentValue);
          if (!Array.isArray(newList)) newList = [];
        } catch (e) {
          newList = [];
        }
      }

      if (mode === 'delete') {
        newList = newList.filter(handle => handle !== productHandle);
        actionType = 'removed';
      } else {
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
          customerUpdate(input: $input) {
            customer { id }
            userErrors { field message }
          }
        }`,
        {
          variables: {
            input: {
              id: `gid://shopify/Customer/${customerId}`,
              metafields: [
                {
                  namespace: "custom",
                  key: "wishlist",
                  value: JSON.stringify(newList),
                  type: "json"
                }
              ]
            }
          }
        }
      );

      const saveResult = await saveMutation.json();
      const userErrors = saveResult.data?.customerUpdate?.userErrors;

      if (userErrors && userErrors.length > 0) {
        console.error("❌ [API] Save Error:", userErrors);
        return customJson({ error: "Save failed", details: userErrors }, { status: 500 });
      }
      console.log("✅ [API] Success! Action:", actionType);

    } else {
      // 🌟 非会員（guest）の場合は、フロントエンドの指示(mode)に従って判定
      actionType = (mode === 'delete') ? 'removed' : 'added';
      console.log("✅ [API] Guest Action:", actionType);
    }


    // =========================================================================
    // ▼▼▼ Prisma連携（ダッシュボード分析用） ▼▼▼
    // =========================================================================
    if (shopDomain) {
      try {
        if (actionType === 'added') {
          // 🌟 非会員の場合はIDをランダムにして「ゲストの新規アクション」として記録
          const dbCustomerId = customerId === "guest" ? `guest_${Date.now()}` : String(customerId);

          const existing = await prisma.favorite.findFirst({
            where: { 
              shop: shopDomain,
              customerId: dbCustomerId, 
              productHandle: String(productHandle) 
            }
          });

          if (!existing) {
            // 🚨 ここを端折ってしまっていました！完全復元しました。
            // Shopifyから商品の詳細（タイトルや画像）を取得
            let productTitle = productHandle;
            let productImageUrl = "";
            try {
               const productQuery = await admin.graphql(
                `query getProductDetails($handle: String!) {
                  productByHandle(handle: $handle) {
                    title
                    featuredImage { url }
                  }
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
                customerId: dbCustomerId, 
                productHandle: String(productHandle)
                // ※もし `productTitle` などのカラムが存在しないエラーが出た場合は、
                // 次の行以降を消せばOKです。
                // referrer: String(referrer || "Direct") // 必要に応じて有効化
              }
            });
            console.log("✅ [DB] Prisma: データベースに追加成功！:", productHandle);
          }
        } else if (actionType === 'removed') {
          // 🌟 非会員のお気に入り解除は「分析用」として残すため、会員の時だけ削除
          if (customerId !== "guest") {
            await prisma.favorite.deleteMany({
              where: { 
                shop: shopDomain,
                customerId: String(customerId), 
                productHandle: String(productHandle) 
              }
            });
            console.log("✅ [DB] Prisma: データベースから削除成功！:", productHandle);
          }
        }
      } catch (dbError) {
        console.error("⚠️ [DB] Prisma連携エラー:", dbError.message);
      }
    } else {
      console.warn("⚠️ [DB] shopDomainが見つからないためDB保存をスキップしました");
    }
    // =========================================================================

    return customJson({ success: true, list: newList, action: actionType });

  } catch (err) {
    console.error("❌ [API] Critical Error:", err);
    return customJson({ error: "Server Error", details: err.message }, { status: 500 });
  }
};

export const loader = async () => customJson({ status: "ok" });