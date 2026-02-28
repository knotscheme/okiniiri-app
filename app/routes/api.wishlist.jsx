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
    // 1. まず「認証」を行いますが、ここでエラーが出ても死なないようにします
    let adminContext = null;
    try {
      const { admin } = await authenticate.public.appProxy(request);
      adminContext = admin;
    } catch (e) {
      console.log("🔹 [Auth] Guest access detected (no admin context)");
    }

    // 2. データを抜き出す
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop") || "shirakawa-2.myshopify.com";
    const body = await request.json().catch(() => ({}));
    const { customerId, productHandle, mode } = body;

    if (!productHandle) return customJson({ error: "Missing handle" });

    // 🌟 最強のゲスト判定（IDが短い、空、guestで始まるならゲスト）
    const idStr = String(customerId || "");
    const isGuest = !customerId || idStr === "" || idStr === "null" || idStr.startsWith("guest");
    const actionType = (mode === 'delete') ? 'removed' : 'added';

    // =========================================================================
    // 3. Prisma連携（分析DB）- ゲストでも100%実行！
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
          console.log("✅ [DB] Prisma save success");
        }
      } else {
        await prisma.favorite.deleteMany({
          where: { shop: shopDomain, customerId: dbId, productHandle: String(productHandle) }
        });
        console.log("✅ [DB] Prisma remove success");
      }
    } catch (dbErr) {
      console.error("⚠️ [DB] Prisma Error:", dbErr.message);
    }

    // =========================================================================
    // 4. Shopify会員データ（Metafield）- IDが「本物」の時だけ実行！
    // =========================================================================
    // 🌟 ここが重要！ IDが数字（5文字以上）でない場合は、Shopify APIを絶対に叩かない
    if (!isGuest && idStr.length > 5 && adminContext) {
      try {
        const customerQuery = await adminContext.graphql(
          `query getC($id: ID!) { customer(id: $id) { metafield(namespace: "custom", key: "wishlist") { value } } }`,
          { variables: { id: `gid://shopify/Customer/${customerId}` } }
        );
        const customerData = await customerQuery.json();
        let list = [];
        const val = customerData.data?.customer?.metafield?.value;
        if (val) list = JSON.parse(val);

        if (mode === 'delete') {
          list = list.filter(h => h !== productHandle);
        } else {
          if (!list.includes(productHandle)) list.push(productHandle);
        }

        await adminContext.graphql(
          `mutation updateC($input: CustomerInput!) { customerUpdate(input: $input) { customer { id } } }`,
          { variables: { input: { id: `gid://shopify/Customer/${customerId}`, metafields: [{ namespace: "custom", key: "wishlist", value: JSON.stringify(list), type: "json" }] } } }
        );
        console.log("✅ [Shopify] Metafield synced");
      } catch (err) {
        console.warn("⚠️ [Shopify] Metafield sync skipped:", err.message);
      }
    }

    return customJson({ success: true, action: actionType });

  } catch (err) {
    console.error("❌ [Critical] API Error:", err);
    return customJson({ error: "Server Error" }, { status: 500 });
  }
};

export const loader = async () => customJson({ status: "ok" });