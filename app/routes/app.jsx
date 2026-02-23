import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Outlet,
  useLoaderData,
  useLocation,
  useRouteError,
} from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const host = url.searchParams.get("host"); // ✅ must have
  const shop = url.searchParams.get("shop"); // (optional but helpful)

  return {
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    host,
    shop,
  };
};

export default function App() {
  const { apiKey, host } = useLoaderData();
  const location = useLocation();

  return (
    <AppProvider embedded apiKey={apiKey} host={host}>
      <s-app-nav>
        <s-link href={`/app${location.search}`}>Home</s-link>
        <s-link href={`/app/additional${location.search}`}>
          Additional page
        </s-link>
      </s-app-nav>

      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => boundary.headers(headersArgs);
