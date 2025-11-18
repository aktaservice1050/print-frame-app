/* eslint-disable no-undef */

import { json } from "@remix-run/node";

export const action = async ({ request }) => {
  console.log("\n========== WEBHOOK RECEIVED ==========");
  console.log("⏰ Time:", new Date().toLocaleString("bn-BD"));

  try {
    const body = await request.json();

    const orderId = body.id;
    const orderNumber = body.order_number;
    const customerEmail = body.email;

    console.log("\n📋 ORDER SUMMARY:");
    console.log(`🆔 Order ID: ${orderId}`);
    console.log(`🔢 Order Number: #${orderNumber}`);
    console.log(`👤 Customer: ${customerEmail}`);

    // -------------------------------
    // 🚀 FIXED: Correct Partner Connect URL
    // -------------------------------
    const partnerApiUrl = `https://api.partner-connect.io/api/hud/order/6eb5f69f-9d04-4662-859b-0ad826660d5b/${orderNumber}/shipment`;

    // ==========================================================
    // 🚀 Shipment Update Payload (correct structure)
    // ==========================================================

    const shipping = body.shipping_address;

    const partnerPayload = {
      shipmentMethodId: "usps_ground_advantage",
      shippingAddress: shipping
        ? {
            companyName: shipping.company || "",
            firstName: shipping.first_name || body.customer?.first_name || "",
            lastName: shipping.last_name || body.customer?.last_name || "",
            addressLine1: shipping.address1 || "",
            addressLine2: shipping.address2 || "",
            city: shipping.city || "",
            postcode: shipping.zip || "",
            country: shipping.country_code || "US",
            email: customerEmail,
            phone: shipping.phone || body.customer?.phone || "",
          }
        : null,
    };

    console.log("\n📤 Payload being sent to Partner API:");
    console.log(JSON.stringify(partnerPayload, null, 2));

    // ==========================================================
    // 🚀 API REQUEST
    // ==========================================================

    let partnerTextResponse = "";
    try {
      const partnerResponse = await fetch(partnerApiUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "ygMsrjnwsQZBMUlK:cTRqd1RyV0izCaBr9t8qBUXp3R5hjHT6",
        },
        body: JSON.stringify(partnerPayload),
      });

      partnerTextResponse = await partnerResponse.text();

      let parsedResponse;
      try {
        parsedResponse = JSON.parse(partnerTextResponse);
      } catch {
        parsedResponse = partnerTextResponse;
      }

      if (partnerResponse.ok) {
        console.log("✅ Partner API Success:", partnerResponse.status);
      } else {
        console.log("❌ Partner API Error:", partnerResponse.status);
      }

      console.log("📨 Response:", parsedResponse);

      return json(
        {
          success: true,
          orderId,
          orderNumber,
          partnerApiStatus: partnerResponse.status,
          partnerApiResponse: parsedResponse,
        },
        { status: 200 },
      );
    } catch (apiError) {
      console.error("❌ Partner API Request Failed:", apiError.message);

      return json(
        {
          success: false,
          message: "Partner API call failed",
          error: apiError.message,
        },
        { status: 200 },
      );
    }
  } catch (error) {
    console.error("❌ WEBHOOK ERROR:", error.message);

    return json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 },
    );
  }
};

export const loader = async () => {
  return json({
    message: "Webhook endpoint working",
    endpoint: "/webhooks/orders/create",
  });
};
