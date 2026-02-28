import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  DeliveryMethod,
  BillingInterval,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

// ★ 今朝決めたプラン名を定数として定義（他のファイルで使いやすくするため）
export const MONTHLY_PLAN_STANDARD = "Standard Plan";
export const MONTHLY_PLAN_PRO = "Pro Plan";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October24, // 安定版のバージョンに固定
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  
  // ▼▼▼ ここを今朝の決定事項（Standard / Pro）に安全に上書きしました ▼▼▼
  // ※無料(Free)は「課金未登録状態」として扱うためここには書きません。
  // ※素晴らしいアイデアだった「30日トライアル」はしっかり引き継いでいます！
  billing: {
    [MONTHLY_PLAN_STANDARD]: {
      amount: 9.99,
      currencyCode: "USD",
      interval: BillingInterval.Every30Days,
      trialDays: 30, // 30日間の無料お試し期間
    },
    [MONTHLY_PLAN_PRO]: {
      amount: 24.99,
      currencyCode: "USD",
      interval: BillingInterval.Every30Days,
      trialDays: 30, // 30日間の無料お試し期間
    },
  },
  // ▲▲▲ 課金設定ここまで ▲▲▲

  future: {
    expiringOfflineAccessTokens: true,
    v3_webhookAdminContext: true,
  },

  webhooks: {
    INVENTORY_LEVELS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
    },
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
    },
  },

  hooks: {
    afterAuth: async ({ session }) => {
      // インストール後にWebhookを登録
      await shopify.registerWebhooks({ session });
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October24;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;