// app/utils/cors.server.js

/**
 * CORS headers যোগ করুন response এ
 */
export function addCorsHeaders(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

/**
 * Specific shop domains এর জন্য CORS
 */
export function addCorsHeadersForShop(response, shop) {
  const allowedOrigins = [
    `https://${shop}`,
    `https://admin.shopify.com`,
    "http://localhost:3000", // Development
  ];

  response.headers.set("Access-Control-Allow-Origin", allowedOrigins[0]);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  response.headers.set("Access-Control-Allow-Credentials", "true");

  return response;
}
