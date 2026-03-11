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

// helper: find image_editable property
const getImageEditable = (body) => {
  const lineItems = Array.isArray(body.line_items) ? body.line_items : [];

  for (const item of lineItems) {
    if (!Array.isArray(item.properties)) continue;

    const prop =
      item.properties.find(
        (p) => String(p?.name || "").toLowerCase() === "image_editable",
      ) ||
      item.properties.find(
        (p) => String(p?.name || "").toLowerCase() === "image editable",
      );

    if (prop) {
      return String(prop.value || "").toLowerCase();
    }
  }

  return null;
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

    const imageEditable = getImageEditable(body);

    console.log("🖼 imageEditable value:", imageEditable);

    if (imageEditable === "editable") {
      console.log("⚠️ Order marked editable → Not sending to partner");

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
              message: "Order is editable -> not sent to partner",
            }),
            type: "json",
          },
        ]);
      }

      return jsonResponse({
        success: true,
        message: "Order is editable → not sent to partner",
        orderId,
        orderNumber,
      });
    }

    const currencyMap = { BDT: "USD", INR: "USD", PKR: "USD" };
    const rawCurrency = body.currency || "USD";
    const validCurrency = currencyMap[rawCurrency] || rawCurrency;

    const lineItems = Array.isArray(body.line_items) ? body.line_items : [];

    const partnerPayload = {
      orderType: "order",
      orderReferenceId: orderNumber,
      customerReferenceId: "InkWorthy",
      ProductName: "inkworthy_certificate",
      currency: validCurrency,
      preventDuplicate: true,
      items: lineItems.map((item) => {
        let frameProperties = {
          paper: "standard",
          orientation: "portrait",
          frameType: "classic",
          frameColor: "wood grain",
          matteType: "matting",
          printType: "4×0",
        };

        if (Array.isArray(item.properties) && item.properties.length) {
          item.properties.forEach((prop) => {
            const key = String(prop?.name || "").toLowerCase();
            const val = prop?.value;

            if (key.includes("paper")) frameProperties.paper = val;
            if (key.includes("orientation")) frameProperties.orientation = val;
            if (key.includes("frame") && key.includes("type"))
              frameProperties.frameType = val;
            if (key.includes("frame") && key.includes("color"))
              frameProperties.frameColor = val;
            if (key.includes("matte")) frameProperties.matteType = val;
            if (key.includes("print")) frameProperties.printType = val;
          });
        }

        const fileProperties =
          (Array.isArray(item.properties)
            ? item.properties.filter((prop) => {
                const name = String(prop?.name || "").toLowerCase();
                return name.includes("file") || name.includes("certificate");
              })
            : []) || [];

        const uniqueFiles = [];
        const seenTypes = new Set();

        fileProperties.forEach((prop) => {
          const url = String(prop?.value || "");

          const isValidUrl =
            url &&
            (url.startsWith("http://") ||
              url.startsWith("https://") ||
              url.startsWith("//"));

          if (!isValidUrl) return;

          const normalizedUrl = url.startsWith("//") ? `https:${url}` : url;

          const baseType = String(prop?.name || "")
            .toLowerCase()
            .includes("certificate")
            ? "certificate"
            : "default";

          let counter = 1;
          let uniqueType = baseType;

          while (seenTypes.has(uniqueType)) {
            uniqueType = `${baseType}_${counter++}`;
          }

          seenTypes.add(uniqueType);
          uniqueFiles.push({
            type: uniqueType,
            url: normalizedUrl,
          });
        });

        const metadata =
          (Array.isArray(item.properties)
            ? item.properties
                .filter((prop) => {
                  const name = String(prop?.name || "").toLowerCase();
                  return (
                    !name.includes("file") && !name.includes("certificate")
                  );
                })
                .map((prop) => ({
                  key: prop?.name,
                  value: prop?.value,
                }))
            : []) || [];

        return {
          itemReferenceId:
            item.variant_id?.toString() || item.product_id?.toString() || "",
          productName: item.title || item.name || "",
          productVariant: {
            paper: frameProperties.paper,
            orientation: frameProperties.orientation,
            frameType: frameProperties.frameType,
            frameColor: frameProperties.frameColor,
            matteType: frameProperties.matteType,
            print_type: frameProperties.printType,
          },
          files: uniqueFiles,
          quantity: item.quantity || 1,
          metadata,
        };
      }),
      shipmentMethodId: "usps_ground_advantage",
      shippingAddress: body.shipping_address
        ? {
            companyName: body.shipping_address.company || "",
            firstName:
              body.shipping_address.first_name ||
              body.customer?.first_name ||
              "",
            lastName:
              body.shipping_address.last_name || body.customer?.last_name || "",
            addressLine1: body.shipping_address.address1 || "",
            addressLine2: body.shipping_address.address2 || "",
            city: body.shipping_address.city || "",
            postcode: body.shipping_address.zip || "",
            country: body.shipping_address.country_code || "US",
            email: customerEmail,
            phone: body.shipping_address.phone || body.customer?.phone || "",
          }
        : null,
    };

    console.log("📤 Partner API Payload:");
    console.log(JSON.stringify(partnerPayload, null, 2));

    const partnerApiUrl =
      "https://api.partner-connect.io/api/hud/6eb5f69f-9d04-4662-859b-0ad826660d5b/order";

    const PARTNER_API_KEY = "ygMsrjnwsQZBMUlK:cTRqd1RyV0izCaBr9t8qBUXp3R5hjHT6";

    console.log("🚀 Sending order to Partner API...");

    const partnerResponse = await fetch(partnerApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": PARTNER_API_KEY,
      },
      body: JSON.stringify(partnerPayload),
    });

    console.log("📡 Partner API Status:", partnerResponse.status);

    const responseText = await partnerResponse.text().catch(() => "");

    console.log("📨 Partner API Response:", responseText);

    const safePartnerApiResponse = JSON.stringify({
      status: partnerResponse.status,
      body: String(responseText || "").slice(0, 45000),
    });

    if (admin && orderGid) {
      await saveOrderMetafields(admin, orderGid, [
        {
          namespace: "custom",
          key: "partner_status",
          value: partnerResponse.ok ? "sent" : "failed",
          type: "single_line_text_field",
        },
        {
          namespace: "custom",
          key: "partner_api_status",
          value: String(partnerResponse.status || 0),
          type: "number_integer",
        },
        {
          namespace: "custom",
          key: "partner_api_response",
          value: safePartnerApiResponse,
          type: "json",
        },
      ]);
    }

    if (!partnerResponse.ok) {
      console.error("❌ Partner API failed");

      return jsonResponse(
        {
          success: false,
          error: "Partner API failed",
          status: partnerResponse.status,
        },
        { status: 500 },
      );
    }

    console.log("✅ Order successfully sent to Partner API");

    return jsonResponse({
      success: true,
      message: "Order sent to partner",
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
