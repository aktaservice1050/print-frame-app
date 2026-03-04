import { Form, useLoaderData, useLocation } from "react-router";
import prisma from "../db.server";

// --- helper: JSON Response for action ---
const jsonResponse = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });

export const loader = async ({ params }) => {
  const order = await prisma.orderQueue.findUnique({
    where: { id: params.id },
  });

  if (!order) {
    throw new Response("Order not found", { status: 404 });
  }

  return { order };
};

export const action = async ({ request, params }) => {
  try {
    const form = await request.formData();

    const order = await prisma.orderQueue.findUnique({
      where: { id: params.id },
    });

    if (!order) {
      return jsonResponse(
        { ok: false, error: "Order not found" },
        { status: 404 },
      );
    }

    const payload = order.partnerPayload || {};
    const items = payload.items || [];

    // update file urls from formData
    items.forEach((it, idx) => {
      const files = it.files || [];
      files.forEach((f, fIdx) => {
        const key = `fileUrl__${idx}__${fIdx}`;
        const newUrl = form.get(key);
        if (typeof newUrl === "string" && newUrl.trim()) {
          f.url = newUrl.trim();
        }
      });
    });

    payload.items = items;

    await prisma.orderQueue.update({
      where: { id: params.id },
      data: {
        partnerPayload: payload,
        status: "editable",
      },
    });

    return jsonResponse({ ok: true }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ ok: false, error: msg }, { status: 500 });
  }
};

export default function OrderDetail() {
  const { order } = useLoaderData();
  const { search } = useLocation();

  const payload = order.partnerPayload || {};
  const items = payload.items || [];

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <a
          href={`/app/orderlist${search}`}
          style={{ textDecoration: "none", color: "#2563eb", fontWeight: 700 }}
        >
          ← Back
        </a>
        <h1 style={{ margin: 0 }}>Order #{order.orderNumber || ""}</h1>
        <span style={badge(order.status)}>{order.status}</span>
      </div>

      <p style={{ marginTop: 8, opacity: 0.8 }}>
        {order.customerEmail ? `Email: ${order.customerEmail}` : "Email: -"} •{" "}
        {order.createdAt ? new Date(order.createdAt).toLocaleString() : "-"}
      </p>

      <div style={{ height: 12 }} />

      <Form method="post">
        <div style={{ display: "grid", gap: 14 }}>
          {items.map((it, idx) => (
            <div key={idx} style={card}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>
                    {it.productName || `Item ${idx + 1}`}
                  </div>
                  <div style={{ opacity: 0.8, marginTop: 4 }}>
                    Qty: {it.quantity || 1}
                  </div>
                </div>
              </div>

              <div style={{ height: 10 }} />

              {(it.files || []).length === 0 ? (
                <div style={{ opacity: 0.8 }}>
                  No files found for this item.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {(it.files || []).map((f, fIdx) => (
                    <div key={fIdx}>
                      <label style={label}>File URL ({f.type || "file"})</label>
                      <input
                        name={`fileUrl__${idx}__${fIdx}`}
                        defaultValue={f.url || ""}
                        placeholder="https://..."
                        style={input}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          <div style={{ display: "flex", gap: 10 }}>
            <button type="submit" style={primaryBtn}>
              Save as Editable
            </button>
            <a href={`/app/orderlist${search}`} style={secondaryBtn}>
              Cancel
            </a>
          </div>
        </div>
      </Form>
    </div>
  );
}

const card = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#fff",
  padding: 14,
};

const label = {
  display: "block",
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 6,
};

const input = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  outline: "none",
  fontSize: 14,
};

const primaryBtn = {
  background: "#111827",
  color: "#fff",
  border: "1px solid #111827",
  borderRadius: 10,
  padding: "10px 14px",
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryBtn = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  padding: "10px 14px",
  fontWeight: 800,
  color: "#111827",
  textDecoration: "none",
  background: "#fff",
};

const badge = (status) => {
  const base = {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    textTransform: "capitalize",
    border: "1px solid transparent",
  };

  if (status === "pending")
    return {
      ...base,
      background: "#fef3c7",
      color: "#92400e",
      borderColor: "#f59e0b",
    };
  if (status === "editable")
    return {
      ...base,
      background: "#dbeafe",
      color: "#1e40af",
      borderColor: "#3b82f6",
    };
  if (status === "failed")
    return {
      ...base,
      background: "#fee2e2",
      color: "#991b1b",
      borderColor: "#ef4444",
    };

  return {
    ...base,
    background: "#e5e7eb",
    color: "#111827",
    borderColor: "#9ca3af",
  };
};
