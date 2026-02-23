import { Form, redirect, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  const shop = url.searchParams.get("shop");
  const host = url.searchParams.get("host");

  // Shopify Admin embedded app URL usually includes both shop + host.
  // If both exist, redirect to the embedded app route and preserve all query params.
  if (shop && host) {
    const params = new URLSearchParams(url.searchParams);
    return redirect(`/app?${params.toString()}`);
  }

  // Sometimes a request arrives with shop but without host.
  // In that case, trigger the auth flow so Shopify can send back the proper embedded params (host, etc).
  if (shop && !host) {
    const params = new URLSearchParams(url.searchParams);
    return redirect(`/auth/login?${params.toString()}`);
    // Alternative for debugging:
    // throw new Response("Missing host param", { status: 400 });
  }

  // Default: show the public landing / login form
  return { showForm: Boolean(login) };
};

export default function Index() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>A short heading about [your app]</h1>

        <p className={styles.text}>
          A tagline about [your app] that describes your value proposition.
        </p>

        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="my-shop.myshopify.com"
                required
              />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>

            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}

        <ul className={styles.list}>
          <li>
            <strong>Product feature</strong>. Some detail about your feature and
            its benefit to your customer.
          </li>
          <li>
            <strong>Product feature</strong>. Some detail about your feature and
            its benefit to your customer.
          </li>
          <li>
            <strong>Product feature</strong>. Some detail about your feature and
            its benefit to your customer.
          </li>
        </ul>
      </div>
    </div>
  );
}
