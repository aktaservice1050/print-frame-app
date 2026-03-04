/* eslint-disable no-undef */
import prisma from "../db.server";

const jsonResponse = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });

export const action = async ({ request }) => {
  try {
    // ---- Robust body parsing (works even if body isn't valid JSON) ----
    let body;
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      body = await request.json().catch(() => null);
    } else {
      const text = await request.text();
      body = text ? JSON.parse(text) : null;
    }

    if (!body || typeof body !== "object") {
      return jsonResponse(
        { success: false, error: "Invalid webhook payload" },
        { status: 400 },
      );
    }

    const orderId = String(body.id || "");
    const orderNumber = String(body.order_number || "");
    const customerEmail = body.email || null;

    if (!orderId || !orderNumber) {
      return jsonResponse(
        { success: false, error: "Missing order id/order_number" },
        { status: 400 },
      );
    }

    const currencyMap = { BDT: "USD", INR: "USD", PKR: "USD" };
    const rawCurrency = body.currency || "USD";
    const validCurrency = currencyMap[rawCurrency] || rawCurrency;

    const lineItems = Array.isArray(body.line_items) ? body.line_items : [];

    const partnerPayload = {
      orderType: "order",
      orderReferenceId: orderNumber,
      customerReferenceId: "InkWorthy",
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
          while (seenTypes.has(uniqueType))
            uniqueType = `${baseType}_${counter++}`;

          seenTypes.add(uniqueType);
          uniqueFiles.push({ type: uniqueType, url: normalizedUrl });
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
                .map((prop) => ({ key: prop?.name, value: prop?.value }))
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

    await prisma.orderQueue.upsert({
      where: { shopifyOrderId: orderId },
      update: {
        orderNumber,
        customerEmail,
        rawCurrency,
        partnerPayload,
        status: "pending",
      },
      create: {
        shopifyOrderId: orderId,
        orderNumber,
        customerEmail,
        rawCurrency,
        partnerPayload,
        status: "pending",
      },
    });

    // Shopify expects 200 quickly
    return jsonResponse(
      { success: true, message: "Saved to queue", orderId, orderNumber },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
