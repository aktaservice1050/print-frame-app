// File: app/routes/app.setup.jsx
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  try {
    const url = new URL(request.url);
    // eslint-disable-next-line no-undef
    const appUrl = process.env.SHOPIFY_APP_URL || `https://${url.host}`;

    const webhooks = [
      {
        topic: "ORDERS_CREATE",
        url: `${appUrl}/webhooks/orders/create`,
        description: "Submit Order (POST)",
      },
      {
        topic: "FULFILLMENTS_CREATE",
        url: `${appUrl}/webhooks/orders/shipment`,
        description: "Create Shipment",
      },
      {
        topic: "FULFILLMENTS_UPDATE",
        url: `${appUrl}/webhooks/orders/shipment`,
        description: "Update Shipment",
      },
      {
        topic: "ORDERS_CANCELLED",
        url: `${appUrl}/webhooks/orders/cancel`,
        description: "Cancel Order (POST)",
      },
    ];

    console.log("🔧 Setting up webhooks...");

    const results = [];

    for (const webhook of webhooks) {
      console.log(`\n📍 Processing: ${webhook.description}`);
      console.log(`   Topic: ${webhook.topic}`);
      console.log(`   URL: ${webhook.url}`);

      const checkQuery = `query {
        webhookSubscriptions(first: 250, topics: ${webhook.topic}) {
          edges {
            node {
              id
              topic
              endpoint {
                __typename
                ... on WebhookHttpEndpoint {
                  callbackUrl
                }
              }
            }
          }
        }
      }`;

      const response = await admin.graphql(checkQuery);
      const data = await response.json();
      const existing = data.data.webhookSubscriptions.edges;

      const alreadyExists = existing.some(
        (edge) => edge.node.endpoint.callbackUrl === webhook.url,
      );

      if (alreadyExists) {
        console.log(`   ✅ Already exists`);
        results.push({
          topic: webhook.topic,
          description: webhook.description,
          status: "exists",
          url: webhook.url,
        });
        continue;
      }

      const createMutation = `mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription {
            id
            topic
          }
          userErrors {
            field
            message
          }
        }
      }`;

      const createResponse = await admin.graphql(createMutation, {
        variables: {
          topic: webhook.topic,
          webhookSubscription: {
            callbackUrl: webhook.url,
            format: "JSON",
          },
        },
      });

      const result = await createResponse.json();

      if (result.data.webhookSubscriptionCreate.userErrors.length > 0) {
        const error = result.data.webhookSubscriptionCreate.userErrors[0];
        console.error(`   ❌ Error: ${error.message}`);
        results.push({
          topic: webhook.topic,
          description: webhook.description,
          status: "error",
          error: error.message,
        });
      } else {
        console.log(`   ✅ Created successfully`);
        results.push({
          topic: webhook.topic,
          description: webhook.description,
          status: "created",
          url: webhook.url,
        });
      }
    }

    console.log("\n" + "=".repeat(50));
    console.log("📊 WEBHOOK SETUP SUMMARY:");
    console.log("=".repeat(50));

    const created = results.filter((r) => r.status === "created").length;
    const exists = results.filter((r) => r.status === "exists").length;
    const errors = results.filter((r) => r.status === "error").length;

    console.log(`✅ Created: ${created}`);
    console.log(`🔄 Already Exists: ${exists}`);
    console.log(`❌ Errors: ${errors}`);
    console.log("=".repeat(50) + "\n");

    return json(
      {
        success: true,
        message: "Webhook setup completed",
        summary: {
          total: results.length,
          created: created,
          exists: exists,
          errors: errors,
        },
        results: results,
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("❌ Fatal Error:", error.message);
    console.error("Stack:", error.stack);

    return json(
      {
        success: false,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
};
