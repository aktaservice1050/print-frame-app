// File: app/routes/webhooks.test.jsx

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const webhookUrl = `${baseUrl}/webhooks/orders/create`;

  // HTML response return করা
  const html = `
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>🧪 Webhook Tester</title>
      <style>
        body {
          font-family: system-ui;
          padding: 20px;
          max-width: 800px;
          margin: 0 auto;
        }
        .card {
          background: #f0f0f0;
          padding: 15px;
          border-radius: 5px;
          margin: 20px 0;
        }
        code {
          display: block;
          background: white;
          padding: 10px;
          margin-top: 10px;
          border-radius: 3px;
          overflow-x: auto;
        }
        button {
          background: #5469d4;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 5px;
          fontSize: 16px;
          cursor: pointer;
        }
        button:hover { background: #3d4fc4; }
        pre {
          background: #2d2d2d;
          color: #f8f8f2;
          padding: 15px;
          border-radius: 5px;
          overflow: auto;
        }
        #result {
          margin-top: 20px;
          padding: 15px;
          border-radius: 5px;
          display: none;
        }
        .success { background: #d4edda; border: 1px solid #c3e6cb; }
        .error { background: #f8d7da; border: 1px solid #f5c6cb; }
      </style>
    </head>
    <body>
      <h1>🧪 Webhook Tester</h1>
      <p>Current Time: ${new Date().toLocaleString("bn-BD")}</p>

      <div className="card">
        <strong>Webhook URL:</strong>
        <code id="webhookUrl">${webhookUrl}</code>
      </div>

      <button onclick="testWebhook()">🚀 Test Webhook</button>

      <div id="result"></div>

      <div style="margin-top: 30px;">
        <h3>📋 Instructions:</h3>
        <ol>
          <li>উপরের "Test Webhook" button এ click করুন</li>
          <li>Terminal/console এ log দেখুন</li>
          <li>Response এখানে দেখবেন</li>
        </ol>

        <h3>📁 File Structure:</h3>
        <pre>app/
├── routes/
│   ├── webhooks.orders.create.jsx  ← Webhook handler
│   └── webhooks.test.jsx           ← This test page</pre>
      </div>

      <script>
        async function testWebhook() {
          const resultDiv = document.getElementById('result');
          const webhookUrl = document.getElementById('webhookUrl').textContent;

          resultDiv.style.display = 'block';
          resultDiv.className = '';
          resultDiv.innerHTML = '⏳ Testing webhook...';

          const testData = {
            id: 123456789,
            order_number: 1001,
            email: "customer@example.com",
            total_price: "199.99",
            created_at: new Date().toISOString(),
            line_items: [{
              id: 1,
              title: "Test Product",
              quantity: 1,
              price: "199.99"
            }]
          };

          try {
            const response = await fetch(webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(testData)
            });

            const result = await response.json();

            resultDiv.className = 'success';
            resultDiv.innerHTML = \`
              <strong>✅ Success!</strong><br>
              Status: \${response.status}<br>
              <pre>\${JSON.stringify(result, null, 2)}</pre>
              <small>Check your terminal for detailed logs</small>
            \`;
          } catch (error) {
            resultDiv.className = 'error';
            resultDiv.innerHTML = \`
              <strong>❌ Error!</strong><br>
              \${error.message}
            \`;
          }
        }
      </script>
    </body>
    </html>
  `;

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
};
