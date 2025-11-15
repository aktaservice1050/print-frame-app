// File: app/routes/webhooks.orders.create.jsx
import { json } from "@remix-run/node";

// ✅ POST request - Shopify webhook এর জন্য
export const action = async ({ request }) => {
  console.log("\n========== WEBHOOK RECEIVED ==========");
  console.log("⏰ Time:", new Date().toLocaleString("bn-BD"));
  console.log("📍 Method:", request.method);
  console.log("🌐 URL:", request.url);

  try {
    // Request body পড়ুন
    const body = await request.json();

    console.log("\n📦 RAW ORDER DATA:");
    console.log(JSON.stringify(body, null, 2));

    // Order information extract
    const orderId = body.id;
    const orderNumber = body.order_number;
    const customerEmail = body.email;
    const totalPrice = body.total_price;
    const lineItems = body.line_items || [];

    console.log("\n" + "=".repeat(50));
    console.log("📋 ORDER SUMMARY:");
    console.log("=".repeat(50));
    console.log(`🆔 Order ID: ${orderId}`);
    console.log(`🔢 Order Number: #${orderNumber}`);
    console.log(`👤 Customer: ${customerEmail}`);
    console.log(`💰 Total: ${totalPrice}`);
    console.log(`📦 Items: ${lineItems.length}`);
    console.log("=".repeat(50));

    // Line items details
    if (lineItems.length > 0) {
      console.log("\n🛍️  LINE ITEMS:");
      lineItems.forEach((item, index) => {
        console.log(`  ${index + 1}. ${item.title || item.name}`);
        console.log(`     Quantity: ${item.quantity}`);
        console.log(`     Price: ${item.price}`);

        // Custom properties check করুন (certificate upload এর জন্য)
        if (item.properties && item.properties.length > 0) {
          console.log(`     Properties:`);
          item.properties.forEach((prop) => {
            console.log(`       - ${prop.name}: ${prop.value}`);
          });
        }
      });
    }

    // Note attributes check করুন (যদি custom data থাকে)
    if (body.note_attributes && body.note_attributes.length > 0) {
      console.log("\n📝 CUSTOM ATTRIBUTES:");
      body.note_attributes.forEach((attr) => {
        console.log(`  - ${attr.name}: ${attr.value}`);
      });
    }

    // Customer details
    if (body.customer) {
      console.log("\n👤 CUSTOMER DETAILS:");
      console.log(
        `  Name: ${body.customer.first_name} ${body.customer.last_name}`,
      );
      console.log(`  Email: ${body.customer.email}`);
      console.log(`  Phone: ${body.customer.phone || "N/A"}`);
    }

    // Shipping address
    if (body.shipping_address) {
      console.log("\n🚚 SHIPPING ADDRESS:");
      console.log(`  ${body.shipping_address.address1}`);
      console.log(
        `  ${body.shipping_address.city}, ${body.shipping_address.zip}`,
      );
      console.log(`  ${body.shipping_address.country}`);
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ WEBHOOK PROCESSED SUCCESSFULLY!");
    console.log("=".repeat(50) + "\n");

    // TODO: এখানে আপনার custom logic add করুন:
    // - Database এ save করা
    // - Email send করা
    // - Third-party API call করা
    // - Certificate processing করা

    return json(
      {
        success: true,
        message: "Webhook received successfully",
        orderId: orderId,
        orderNumber: orderNumber,
        timestamp: new Date().toISOString(),
        processed: true,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error("\n❌ ========== WEBHOOK ERROR ==========");
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);
    console.error("=====================================\n");

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

// ✅ GET request - Testing এর জন্য
export const loader = async () => {
  return json(
    {
      message: "✅ Webhook endpoint is working!",
      endpoint: "/webhooks/orders/create",
      methods: ["POST"],
      note: "This endpoint only accepts POST requests from Shopify",
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
    },
  );
};
