/* eslint-disable no-undef */
// File: app/routes/webhooks.orders.cancel.jsx
import { json } from "@remix-run/node";

export const action = async ({ request }) => {
  console.log("\n========== ORDER CANCELLATION WEBHOOK ==========");
  console.log("⏰ Time:", new Date().toLocaleString("bn-BD"));

  try {
    const body = await request.json();

    const orderId = body.id;
    const orderNumber = body.order_number;
    const cancelledAt = body.cancelled_at;
    const cancelReason = body.cancel_reason;
    const customerEmail = body.email;
    const totalPrice = body.total_price;
    const lineItems = body.line_items || [];
    const financialStatus = body.financial_status;
    const fulfillmentStatus = body.fulfillment_status;

    console.log("\n📋 CANCELLATION SUMMARY:");
    console.log(`🆔 Order ID: ${orderId}`);
    console.log(`🔢 Order Number: #${orderNumber}`);
    console.log(`👤 Customer: ${customerEmail}`);
    console.log(`💰 Total: ${totalPrice}`);
    console.log(`❌ Cancel Reason: ${cancelReason || "Not specified"}`);
    console.log(`💳 Financial Status: ${financialStatus}`);
    console.log(`📦 Fulfillment Status: ${fulfillmentStatus}`);
    console.log(`📦 Items: ${lineItems.length}`);

    // Partner Connect API - Cancel Order
    console.log("\n🚫 Cancelling order in Partner Connect API...");

    const partnerApiUrl = `https://api.partner-connect.io/api/hud/order/6eb5f69f-9d04-4662-859b-0ad826660d5b/${orderNumber}/cancel`;
    // Valid currency mapping
    const currencyMap = {
      BDT: "USD",
      INR: "USD",
      PKR: "USD",
      // Add other currencies that need mapping
    };

    const rawCurrency = body.currency || "USD";
    const validCurrency = currencyMap[rawCurrency] || rawCurrency;
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

        if (item.properties && item.properties.length > 0) {
          item.properties.forEach((prop) => {
            const key = prop.name.toLowerCase();
            if (key.includes("paper")) frameProperties.paper = prop.value;
            if (key.includes("orientation"))
              frameProperties.orientation = prop.value;
            if (key.includes("frame") && key.includes("type"))
              frameProperties.frameType = prop.value;
            if (key.includes("frame") && key.includes("color"))
              frameProperties.frameColor = prop.value;
            if (key.includes("matte")) frameProperties.matteType = prop.value;
            if (key.includes("print")) frameProperties.printType = prop.value;
          });
        }

        // Extract and validate file URLs
        const fileProperties =
          item.properties?.filter(
            (prop) =>
              prop.name.toLowerCase().includes("file") ||
              prop.name.toLowerCase().includes("certificate"),
          ) || [];

        // Create unique file types and validate URLs
        const uniqueFiles = [];
        const seenTypes = new Set();

        fileProperties.forEach((prop) => {
          const url = prop.value;

          // Validate URL
          const isValidUrl =
            url &&
            (url.startsWith("http://") ||
              url.startsWith("https://") ||
              url.startsWith("//")); // Protocol-relative URLs

          if (isValidUrl) {
            // Ensure URL has protocol
            const normalizedUrl = url.startsWith("//") ? `https:${url}` : url;

            // Create unique type names
            let fileType = prop.name.toLowerCase().includes("certificate")
              ? "certificate"
              : "default";

            // Make type unique if already seen
            let counter = 1;
            let uniqueType = fileType;
            while (seenTypes.has(uniqueType)) {
              uniqueType = `${fileType}_${counter}`;
              counter++;
            }

            seenTypes.add(uniqueType);
            uniqueFiles.push({
              type: uniqueType,
              url: normalizedUrl,
            });
          } else {
            console.warn(`⚠️ Skipping invalid URL: ${url}`);
          }
        });

        return {
          itemReferenceId:
            item.variant_id?.toString() || item.product_id?.toString(),
          productName: item.title || item.name,
          productVariant: {
            paper: frameProperties.paper,
            orientation: frameProperties.orientation,
            frameType: frameProperties.frameType,
            frameColor: frameProperties.frameColor,
            matteType: frameProperties.matteType,
            print_type: frameProperties.printType,
          },
          files: uniqueFiles,
          quantity: item.quantity,
          metadata:
            item.properties
              ?.filter(
                (prop) =>
                  !prop.name.toLowerCase().includes("file") &&
                  !prop.name.toLowerCase().includes("certificate"),
              )
              .map((prop) => ({
                key: prop.name,
                value: prop.value,
              })) || [],
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

    try {
      const partnerResponse = await fetch(partnerApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "ygMsrjnwsQZBMUlK:cTRqd1RyV0izCaBr9t8qBUXp3R5hjHT6",
        },
        body: JSON.stringify(partnerPayload),
      });

      const partnerData = await partnerResponse.json();

      if (partnerResponse.ok) {
        console.log(
          "✅ Partner API Cancellation Success - Status:",
          partnerResponse.status,
        );
      } else {
        console.error(
          "❌ Partner API Cancellation Error - Status:",
          partnerResponse.status,
        );
        console.error("Response:", JSON.stringify(partnerData, null, 2));
      }

      return json(
        {
          success: true,
          message:
            "Order cancellation webhook received and sent to Partner API",
          orderId: orderId,
          orderNumber: orderNumber,
          cancelledAt: cancelledAt,
          cancelReason: cancelReason,
          partnerApiStatus: partnerResponse.status,
          partnerApiResponse: partnerData,
          timestamp: new Date().toISOString(),
          processed: true,
        },
        {
          status: 200,
        },
      );
    } catch (apiError) {
      console.error(
        "❌ Partner API Cancellation Call Failed:",
        apiError.message,
      );

      return json(
        {
          success: true,
          message:
            "Order cancellation webhook received but Partner API call failed",
          orderId: orderId,
          orderNumber: orderNumber,
          cancelReason: cancelReason,
          apiError: apiError.message,
          timestamp: new Date().toISOString(),
          processed: true,
        },
        {
          status: 200,
        },
      );
    }
  } catch (error) {
    console.error("❌ CANCELLATION WEBHOOK ERROR:", error.message);

    return json(
      {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      {
        status: 500,
      },
    );
  }
};

export const loader = async () => {
  return json(
    {
      message: "✅ Order cancellation webhook endpoint is working!",
      endpoint: "/webhooks/orders/cancel",
      methods: ["POST"],
      note: "This endpoint only accepts POST requests from Shopify for order cancellations",
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
    },
  );
};
