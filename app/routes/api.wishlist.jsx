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
    let adminContext = null;
    try {
      const { admin } = await authenticate.public.appProxy(request);
      adminContext = admin;
    } catch (e) {
      console.log("🔹 [Auth] Guest access detected");
    }

    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop") || "shirakawa-2.myshopify.com";
    const body = await request.json().catch(() => ({}));
    
    // 🌟 修正：referrer をここに追加しました！これでLINEを拾えます
    const { customerId, productHandle, mode, referrer } = body;

    if (!productHandle) return customJson({ error: "Missing handle" });

    const idStr = String(customerId || "");
    const isGuest = !customerId || idStr === "" || idStr === "null" || idStr.startsWith("guest");
    const actionType = (mode === 'delete') ? 'removed' : 'added';

    // =========================================================================
    // 2. Prisma保存（流入元も一緒に記録）
    // =========================================================================
    try {
      const dbId = isGuest ? (customerId || "guest_anonymous") : idStr;
      if (actionType === 'added') {
        const existing = await prisma.favorite.findFirst({
          where: { shop: shopDomain, customerId: dbId, productHandle: String(productHandle) }
        });
        if (!existing) {
          await prisma.favorite.create({
            data: { 
              shop: shopDomain, 
              customerId: dbId, 
              productHandle: String(productHandle),
              // 🌟 ここで確実に保存します
              referrer: String(referrer || "Direct") 
            }
          });
          console.log(`✅ [DB] 保存成功！ 流入元: ${referrer}`);
        }
      } else {
        await prisma.favorite.deleteMany({
          where: { shop: shopDomain, customerId: dbId, productHandle: String(productHandle) }
        });
      }
    } catch (dbErr) {
      console.error("⚠️ [DB] Prisma Error:", dbErr.message);
    }

    // 会員同期処理（安全ガード付き）
    if (!isGuest && idStr.length > 5 && adminContext) {
      try {
        const customerQuery = await adminContext.graphql(
          `query getC($id: ID!) { customer(id: $id) { metafield(namespace: "custom", key: "wishlist") { value } } }`,
          { variables: { id: `gid://shopify/Customer/${customerId}` } }
        ).catch(() => null);
        if (customerQuery) {
          const customerData = await customerQuery.json();
          let list = [];
          const val = customerData.data?.customer?.metafield?.value;
          if (val) try { list = JSON.parse(val); } catch(e) {}
          if (mode === 'delete') { list = list.filter(h => h !== productHandle); }
          else { if (!list.includes(productHandle)) list.push(productHandle); }
          await adminContext.graphql(
            `mutation updateC($input: CustomerInput!) { customerUpdate(input: $input) { customer { id } } }`,
            { variables: { input: { id: `gid://shopify/Customer/${customerId}`, metafields: [{ namespace: "custom", key: "wishlist", value: JSON.stringify(list), type: "json" }] } } }
          ).catch(() => null);
        }
      } catch (e) {}
    }

    return customJson({ success: true, action: actionType });

  } catch (err) {
    console.error("❌ [Critical] Error:", err);
    return customJson({ error: "Server Error" }, { status: 500 });
  }
};

export const loader = async () => customJson({ status: "ok" });