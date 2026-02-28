import { authenticate } from "../shopify.server";
import db from "../db.server";

// 安定動作のための自作jsonレスポンス（notify.jsxと同じ）
const json = (data, init = {}) => {
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
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { session } = await authenticate.public.appProxy(request);
    const body = await request.json().catch(() => ({}));
    const { items, customerEmail, shop } = body;

    if (!shop || !customerEmail || !items || !Array.isArray(items)) {
      return json({ error: "Invalid data" }, { status: 400 });
    }

    // --- 同期処理 ---
    // 送られてきたアイテムリストをぶん回してDBに保存します
    const promises = items.map(async (item) => {
      const { productHandle, variantId } = item;
      const safeVariantId = variantId ? String(variantId) : "";

      // 既に登録済みかチェック
      const existing = await db.restockRequest.findFirst({
        where: { shop, productHandle, variantId: safeVariantId, customerEmail }
      });

      // なければ作成（通知OFF状態で保存し、ウィッシュリストとして扱う）
      if (!existing) {
        return db.restockRequest.create({
          data: {
            shop,
            productHandle,
            variantId: safeVariantId,
            customerEmail,
            referrer: "sync-from-local",
            isNotified: false 
          }
        });
      }
    });

    // 全部の処理が終わるのを待つ
    await Promise.all(promises);

    return json({ success: true, message: "Sync complete" });

  } catch (err) {
    console.error("❌ Sync Error:", err);
    return json({ error: "Server Error" }, { status: 500 });
  }
};