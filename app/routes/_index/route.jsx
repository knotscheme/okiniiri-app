import { redirect } from "react-router"; // ★ここを修正しました
import { authenticate, login } from "../../shopify.server";

// 1. API処理（action）はそのまま残します
export const action = async ({ request }) => {
  const { admin } = await authenticate.public.appProxy(request);

  if (!admin) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const data = await request.json();
    
    const customerId = data.customerId;
    const itemHandle = data.productHandle || data.productId;

    if (!itemHandle) {
      return new Response(JSON.stringify({ error: "No handle" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log(`=== お気に入り処理開始: ${itemHandle} ===`);

    const response = await admin.graphql(
      `query getCustomer($id: ID!) {
        customer(id: $id) {
          wishlist: metafield(namespace: "custom", key: "wishlist") { value }
        }
      }`,
      { variables: { id: `gid://shopify/Customer/${customerId}` } }
    );

    const resJson = await response.json();
    const currentVal = resJson.data.customer?.wishlist?.value;
    let wishlist = currentVal ? JSON.parse(currentVal) : [];

    if (wishlist.includes(itemHandle)) {
      wishlist = wishlist.filter((item) => item !== itemHandle);
    } else {
      wishlist.push(itemHandle);
    }

    await admin.graphql(
      `mutation setMetafield($input: MetafieldsSetInput!) {
        metafieldsSet(metafields: [$input]) { userErrors { message } }
      }`,
      {
        variables: {
          input: {
            namespace: "custom",
            key: "wishlist",
            ownerId: `gid://shopify/Customer/${customerId}`,
            type: "list.product_reference",
            value: JSON.stringify(wishlist),
          },
        },
      }
    );
    
    return new Response(JSON.stringify({ success: true, wishlist }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("❌ サーバーエラー:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

// 2. 自動転送（loader）
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  
  // 管理画面からのアクセスなら /app へ転送
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  
  return login(request);
};

// 3. 表示なし
export default function Index() {
  return null;
}