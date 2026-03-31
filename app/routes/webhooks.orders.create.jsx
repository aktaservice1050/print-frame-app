/* eslint-disable no-undef */
import { authenticate } from "../shopify.server";

// helper: JSON Response
const jsonResponse = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });

// helper: numeric order id -> Shopify GID
const toOrderGid = (id) => {
  if (!id) return "";
  const str = String(id);
  if (str.startsWith("gid://shopify/Order/")) return str;
  if (/^\d+$/.test(str)) return `gid://shopify/Order/${str}`;
  return str;
};

// helper: save metafields on order
const saveOrderMetafields = async (admin, orderGid, metafields = []) => {
  if (!admin || !orderGid || !metafields.length) return;

  console.log("💾 Saving metafields on order:", orderGid);

  const response = await admin.graphql(
    `#graphql
      mutation updateOrderMetafields($input: OrderInput!) {
        orderUpdate(input: $input) {
          order { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        input: {
          id: orderGid,
          metafields,
        },
      },
    },
  );

  const result = await response.json();
  const userErrors = result?.data?.orderUpdate?.userErrors || [];

  if (userErrors.length) {
    console.error("❌ Metafield save error:", userErrors);
    throw new Error(userErrors[0].message || "Failed to save metafields");
  }

  console.log("✅ Metafields saved successfully");
};

export const action = async ({ request }) => {
  let admin = null;

  try {
    console.log("📩 Webhook request received");

    // webhook authentication + payload + admin client
    const webhook = await authenticate.webhook(request);
    admin = webhook.admin;
    const body = webhook.payload;

    console.log("📦 Webhook payload:", JSON.stringify(body, null, 2));

    if (!body || typeof body !== "object") {
      console.error("❌ Invalid webhook payload");
      return jsonResponse(
        { success: false, error: "Invalid webhook payload" },
        { status: 400 },
      );
    }

    const orderId = String(body.id || "");
    const orderGid = toOrderGid(orderId);
    const orderNumber = String(body.order_number || "");
    const customerEmail = body.email || null;

    console.log("🧾 Order Info:", {
      orderId,
      orderGid,
      orderNumber,
      customerEmail,
    });

    if (!orderId || !orderNumber) {
      console.error("❌ Missing order id/order_number");
      return jsonResponse(
        { success: false, error: "Missing order id/order_number" },
        { status: 400 },
      );
    }

    // ✅ সব order editable — webhook এ partner এ পাঠানো হবে না
    // Review page থেকে manually Send to Partner করতে হবে
    console.log(
      "⚠️ All orders are editable → Not sending to partner from webhook",
    );

    if (admin && orderGid) {
      await saveOrderMetafields(admin, orderGid, [
        {
          namespace: "custom",
          key: "partner_status",
          value: "editable",
          type: "single_line_text_field",
        },
        {
          namespace: "custom",
          key: "partner_api_status",
          value: "0",
          type: "number_integer",
        },
        {
          namespace: "custom",
          key: "partner_api_response",
          value: JSON.stringify({
            message:
              "All orders are editable → not sent to partner from webhook",
          }),
          type: "json",
        },
      ]);
    }

    return jsonResponse({
      success: true,
      message: "Order received and marked as editable → pending manual review",
      orderId,
      orderNumber,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error("🔥 Webhook Error:", message);

    return jsonResponse({ success: false, error: message }, { status: 500 });
  }
};

export const loader = async () =>
  jsonResponse({
    message: "✅ Webhook endpoint is working!",
    endpoint: "/webhooks/orders/create",
    methods: ["POST"],
    timestamp: new Date().toISOString(),
  });
