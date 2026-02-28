import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";

// ★ここがポイント：
// ステップ1でインストールしたバージョンなら、このパスで確実に存在します
import "./polaris.css";

export const loader = async () => {
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
        {/* App Bridge のスクリプト */}
        <script
          src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
          data-api-key={apiKey}
        ></script>
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}