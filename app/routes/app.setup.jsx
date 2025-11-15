// File: app/routes/app.setup.jsx
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  try {
    const url = new URL(request.url);
    // eslint-disable-next-line no-undef
    const appUrl = process.env.SHOPIFY_APP_URL || `https://${url.host}`;
    const webhookUrl = `${appUrl}/webhooks/orders/create`;

    console.log("🔧 Setting up webhook...");
    console.log("📍 URL:", webhookUrl);

    // Check existing webhooks
    const response = await admin.graphql(
      `query {
        webhookSubscriptions(first: 50, topics: ORDERS_CREATE) {
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
      }`,
    );

    const data = await response.json();
    const existing = data.data.webhookSubscriptions.edges;

    if (existing.length > 0) {
      console.log("✅ Webhook already exists");
      return new Response(
        `<h1>✅ Webhook Already Registered</h1><p>URL: ${webhookUrl}</p>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }

    // Create webhook
    const createResponse = await admin.graphql(
      `mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
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
      }`,
      {
        variables: {
          topic: "ORDERS_CREATE",
          webhookSubscription: {
            callbackUrl: webhookUrl,
            format: "JSON",
          },
        },
      },
    );

    const result = await createResponse.json();

    if (result.data.webhookSubscriptionCreate.userErrors.length > 0) {
      const error = result.data.webhookSubscriptionCreate.userErrors[0];
      console.error("❌ Error:", error.message);
      return new Response(`<h1>❌ Failed</h1><p>${error.message}</p>`, {
        headers: { "Content-Type": "text/html" },
        status: 400,
      });
    }

    console.log("✅ Webhook created successfully!");
    return new Response(
      `<h1>✅ Webhook Created!</h1><p>URL: ${webhookUrl}</p><p>Now place a test order.</p>`,
      { headers: { "Content-Type": "text/html" } },
    );
  } catch (error) {
    console.error("❌ Error:", error.message);
    return new Response(`<h1>❌ Error</h1><p>${error.message}</p>`, {
      headers: { "Content-Type": "text/html" },
      status: 500,
    });
  }
};
