import { Link, Outlet, useLoaderData, useRouteError } from "react-router"; // ★ Link を追加しました
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <ShopifyAppProvider isEmbeddedApp apiKey={apiKey}>
      <PolarisAppProvider i18n={enTranslations}>
        <ui-nav-menu>
          <Link to="/app" rel="home">Home</Link>
          <Link to="/app/analysis">Analytics</Link> {/* ← これが正しく動くようになります */}
          <Link to="/app/additional">Settings</Link>
        </ui-nav-menu>
        <Outlet />
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};