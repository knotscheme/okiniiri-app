import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  console.log("=== メタフィールド保存処理を開始 ===");

  try {
    // 1. Shopifyの認証を通す（これでadmin権限が使えるようになります）
    const { admin } = await authenticate.public.appProxy(request);

    if (!admin) {
      return new Response(JSON.stringify({ success: false, error: "認証失敗" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await request.json();
    const { customerId, productId } = data;
    const customerGid = `gid://shopify/Customer/${customerId}`;

    // 2. 現在保存されているお気に入りリストを取得する
    const getResponse = await admin.graphql(
      `#graphql
      query getCustomerMeta($id: ID!) {
        customer(id: $id) {
          metafield(namespace: "custom", key: "wishlist") { value }
        }
      }`,
      { variables: { id: customerGid } }
    );

    const getResJson = await getResponse.json();
    let wishlist = [];
    const currentVal = getResJson.data?.customer?.metafield?.value;
    if (currentVal) wishlist = JSON.parse(currentVal);

    // 3. リストに追加（重複チェック）
    if (!wishlist.includes(productId)) {
      wishlist.push(productId);
    }

    // 4. 更新したリストをメタフィールドに書き戻す
    const updateResponse = await admin.graphql(
      `#graphql
      mutation updateCustomerMeta($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id }
          userErrors { message }
        }
      }`,
      {
        variables: {
          input: {
            id: customerGid,
            metafields: [{
              namespace: "custom",
              key: "wishlist",
              type: "json",
              value: JSON.stringify(wishlist)
            }]
          }
        }
      }
    );

    console.log(`★保存完了★ 顧客:${customerId} 商品:${productId}`);

    return new Response(JSON.stringify({ success: true, wishlist }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("保存失敗:", error.message);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200, // ブラウザ側でエラー画面を出さないために200で返します
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const loader = () => {
  return new Response(JSON.stringify({ status: "API Ready" }), {
    headers: { "Content-Type": "application/json" },
  });
};