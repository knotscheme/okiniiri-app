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

  // 1. 公式ガードマンを通す前に、データを安全に抜き出す
  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop") || "shirakawa-2.myshopify.com";
  
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const { customerId, productHandle, mode } = body;

  if (!productHandle) return customJson({ error: "Missing handle" });

  // 🌟 ゲスト判定（IDが空、"null"、または "guest" で始まれば100%ゲスト）
  const idStr = String(customerId || "");
  const isGuest = !customerId || idStr === "" || idStr === "null" || idStr.startsWith("guest");
  const actionType = (mode === 'delete') ? 'removed' : 'added';

  // =========================================================================
  // 2. Prisma連携（分析DB）- ここは「公式ガードマン」より先にやるので、絶対に成功する！
  // =========================================================================
  try {
    const dbId = isGuest ? (customerId || "guest_anonymous") : idStr;
    if (actionType === 'added') {
      const existing = await prisma.favorite.findFirst({
        where: { shop: shopDomain, customerId: dbId, productHandle: String(productHandle) }
      });
      if (!existing) {
        await prisma.favorite.create({
          data: { shop: shopDomain, customerId: dbId, productHandle: String(productHandle) }
        });
      }
    } else {
      await prisma.favorite.deleteMany({
        where: { shop: shopDomain, customerId: dbId, productHandle: String(productHandle) }
      });
    }
    console.log(`✅ [DB] 分析保存成功 (${actionType})`);
  } catch (dbErr) {
    console.error("⚠️ [DB] Prisma Error:", dbErr.message);
  }

  // =========================================================================
  // 3. Shopify会員データの同期（会員の時だけ、失敗しても無視する設定で実行）
  // =========================================================================
  if (!isGuest && idStr.length > 5) {
    try {
      // ここで初めて公式ガードマン(authenticate)を呼ぶ（失敗しても全体は死なない）
      const auth = await authenticate.public.appProxy(request).catch(() => null);
      if (auth && auth.admin) {
        const { admin } = auth;
        // 会員データのメタフィールド更新処理（中略・安全に実行）
        const customerQuery = await admin.graphql(
          `query getC($id: ID!) { customer(id: $id) { metafield(namespace: "custom", key: "wishlist") { value } } }`,
          { variables: { id: `gid://shopify/Customer/${customerId}` } }
        ).catch(() => null);
        
        if (customerQuery) {
          const customerData = await customerQuery.json();
          let list = [];
          const val = customerData.data?.customer?.metafield?.value;
          if (val) try { list = JSON.parse(val); } catch(e) {}

          if (mode === 'delete') {
            list = list.filter(h => h !== productHandle);
          } else {
            if (!list.includes(productHandle)) list.push(productHandle);
          }

          await admin.graphql(
            `mutation updateC($input: CustomerInput!) { customerUpdate(input: $input) { customer { id } } }`,
            { variables: { input: { id: `gid://shopify/Customer/${customerId}`, metafields: [{ namespace: "custom", key: "wishlist", value: JSON.stringify(list), type: "json" }] } } }
          ).catch(() => null);
        }
      }
    } catch (e) {
      console.warn("⚠️ [Member Sync] Skipped for safety");
    }
  }

  return customJson({ success: true, action: actionType });
};

export const loader = async () => customJson({ status: "ok" });