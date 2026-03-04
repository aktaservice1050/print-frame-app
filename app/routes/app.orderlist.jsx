/* eslint-disable no-undef */
import React from "react";
import {
  Form,
  useActionData,
  useLoaderData,
  useRevalidator,
  useSearchParams,
} from "react-router";
import prisma from "../db.server";
/** --- helper: JSON Response --- */
const jsonResponse = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");

  // ✅ show everything you may want in queue
  const orders = await prisma.orderQueue.findMany({
    where: {
      status: { in: ["pending", "editable", "ready", "failed", "sent"] },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const selectedOrder = orderId
    ? await prisma.orderQueue.findUnique({ where: { id: orderId } })
    : null;

  return { orders, selectedOrder, orderId };
};

export const action = async ({ request }) => {
  try {
    const form = await request.formData();
    const intent = String(form.get("_intent") || "");
    const orderId = String(form.get("orderId") || "");

    if (!orderId) {
      return jsonResponse(
        { ok: false, error: "Missing orderId" },
        { status: 400 },
      );
    }

    const order = await prisma.orderQueue.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      return jsonResponse(
        { ok: false, error: "Order not found" },
        { status: 404 },
      );
    }

    // -------------------------
    // 0) SET NEEDS EDIT (true/false)
    // -------------------------
    if (intent === "set_needs_edit") {
      const v = String(form.get("needsEdit") || "false") === "true";

      // ✅ Optional auto status rule (recommended)
      // - needsEdit=true => editable
      // - needsEdit=false => pending (direct send allowed)
      const nextStatus = v ? "editable" : "pending";

      await prisma.orderQueue.update({
        where: { id: orderId },
        data: { needsEdit: v, status: nextStatus },
      });

      return jsonResponse(
        { ok: true, intent, needsEdit: v, status: nextStatus },
        { status: 200 },
      );
    }

    // -------------------------
    // 1) SAVE FILE URLS + MARK EDITABLE (editing in progress)
    // -------------------------
    if (intent === "save_editable") {
      const payload = order.partnerPayload || {};
      const items = payload.items || [];

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
        where: { id: orderId },
        data: {
          partnerPayload: payload,
          status: "editable",
        },
      });

      return jsonResponse({ ok: true, intent }, { status: 200 });
    }

    // -------------------------
    // 2) UPDATE STATUS (pending/editable/ready/sent/failed)
    // -------------------------
    if (intent === "update_status") {
      const nextStatus = String(form.get("nextStatus") || "").trim();

      const allowed = new Set([
        "pending",
        "editable",
        "ready",
        "sent",
        "failed",
      ]);
      if (!allowed.has(nextStatus)) {
        return jsonResponse(
          { ok: false, error: "Invalid status" },
          { status: 400 },
        );
      }

      // ✅ rule: if needsEdit=true, "ready" means editing done
      await prisma.orderQueue.update({
        where: { id: orderId },
        data: { status: nextStatus },
      });

      return jsonResponse({ ok: true, intent, nextStatus }, { status: 200 });
    }

    // -------------------------
    // 3) SEND TO PARTNER
    // -------------------------
    if (intent === "send_partner") {
      const needsEdit = !!order.needsEdit;
      const canSend = !needsEdit || order.status === "ready";

      if (!canSend) {
        return jsonResponse(
          { ok: false, error: "Editing required. Mark status as READY first." },
          { status: 400 },
        );
      }

      const partnerApiUrl =
        "https://api.partner-connect.io/api/hud/6eb5f69f-9d04-4662-859b-0ad826660d5b/order";

      const res = await fetch(partnerApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": process.env.PARTNER_API_KEY,
        },
        body: JSON.stringify(order.partnerPayload),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        await prisma.orderQueue.update({
          where: { id: orderId },
          data: {
            status: "sent",
            partnerApiStatus: res.status,
            partnerApiResponse: data,
          },
        });

        return jsonResponse(
          { ok: true, intent, status: res.status, data },
          { status: 200 },
        );
      }

      await prisma.orderQueue.update({
        where: { id: orderId },
        data: {
          status: "failed",
          partnerApiStatus: res.status,
          partnerApiResponse: data,
        },
      });

      return jsonResponse(
        { ok: false, intent, status: res.status, data },
        { status: 400 },
      );
    }

    return jsonResponse(
      { ok: false, error: "Unknown intent" },
      { status: 400 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ ok: false, error: msg }, { status: 500 });
  }
};

export default function OrderReviewSinglePage() {
  const { orders, selectedOrder, orderId } = useLoaderData();
  const actionData = useActionData();
  const revalidator = useRevalidator();
  const [sp, setSp] = useSearchParams();

  // ✅ refresh UI after any successful action
  React.useEffect(() => {
    if (actionData?.ok) revalidator.revalidate();
  }, [actionData, revalidator]);

  const selectOrder = (id) => {
    const next = new URLSearchParams(sp);
    next.set("orderId", id);
    setSp(next);
  };

  const clearSelection = () => {
    const next = new URLSearchParams(sp);
    next.delete("orderId");
    setSp(next);
  };

  const payload = selectedOrder?.partnerPayload || {};
  const items = payload.items || [];

  const needsEdit = !!selectedOrder?.needsEdit;
  const canSend =
    !!selectedOrder && (!needsEdit || selectedOrder.status === "ready");

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Order Review Queue</h1>
          <p style={styles.subtitle}>
            Pending / Editable / Ready / Failed / Sent
          </p>
        </div>

        <div style={styles.metaRight}>
          <span style={styles.countPill}>Total: {orders?.length ?? 0}</span>
        </div>
      </div>

      {actionData?.ok === false && actionData?.error && (
        <div style={styles.alertError}>{actionData.error}</div>
      )}
      {actionData?.ok === true && <div style={styles.alertOk}>Saved ✅</div>}

      {/* 2-column layout */}
      <div style={styles.grid}>
        {/* LEFT: Table */}
        <div style={styles.card}>
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.theadRow}>
                  {[
                    "Pick",
                    "Status",
                    "Order #",
                    "Email",
                    "Needs Edit",
                    "Created",
                  ].map((h) => (
                    <th key={h} style={styles.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {(orders || []).map((o, idx) => (
                  <tr
                    key={o.id}
                    style={{
                      ...styles.tr,
                      backgroundColor: idx % 2 === 0 ? "#fff" : "#f9fafb",
                      cursor: "pointer",
                    }}
                    onClick={() => selectOrder(o.id)}
                  >
                    <td style={styles.td}>
                      <input
                        type="radio"
                        name="pickedOrder"
                        checked={orderId === o.id}
                        onChange={() => selectOrder(o.id)}
                      />
                    </td>

                    <td style={styles.td}>
                      <span style={badge(o.status)}>{o.status}</span>
                    </td>

                    <td style={styles.tdStrong}>{o.orderNumber || "-"}</td>
                    <td style={styles.tdMuted}>{o.customerEmail || "-"}</td>
                    <td style={styles.tdMuted}>{o.needsEdit ? "Yes" : "No"}</td>
                    <td style={styles.tdMuted}>
                      {o.createdAt
                        ? new Date(o.createdAt).toLocaleString()
                        : "-"}
                    </td>
                  </tr>
                ))}

                {(orders?.length ?? 0) === 0 && (
                  <tr>
                    <td style={{ ...styles.td, padding: 18 }} colSpan={6}>
                      No orders.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: Detail panel */}
        <div style={styles.detailCard}>
          {!selectedOrder ? (
            <div style={{ padding: 16, opacity: 0.8 }}>
              Select an order using the radio button to review here.
            </div>
          ) : (
            <div style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>
                  Order #{selectedOrder.orderNumber || ""}
                </h2>
                <span style={badge(selectedOrder.status)}>
                  {selectedOrder.status}
                </span>

                <button type="button" onClick={clearSelection} style={tinyBtn}>
                  Clear
                </button>
              </div>

              <p style={{ marginTop: 8, opacity: 0.8 }}>
                {selectedOrder.customerEmail
                  ? `Email: ${selectedOrder.customerEmail}`
                  : "Email: -"}{" "}
                •{" "}
                {selectedOrder.createdAt
                  ? new Date(selectedOrder.createdAt).toLocaleString()
                  : "-"}
              </p>

              <div style={{ height: 10 }} />

              <Form method="post">
                <input type="hidden" name="orderId" value={selectedOrder.id} />

                {/* Needs Edit */}
                <div style={{ ...card, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>
                    Needs image editing?
                  </div>

                  <label style={radioRow}>
                    <input
                      type="radio"
                      name="needsEdit"
                      value="false"
                      defaultChecked={!selectedOrder.needsEdit}
                    />
                    <span>✅ No, send directly</span>
                  </label>

                  <label style={radioRow}>
                    <input
                      type="radio"
                      name="needsEdit"
                      value="true"
                      defaultChecked={!!selectedOrder.needsEdit}
                    />
                    <span>✏️ Yes, requires editing</span>
                  </label>

                  <button
                    type="submit"
                    name="_intent"
                    value="set_needs_edit"
                    style={{ ...secondaryBtn, marginTop: 10 }}
                  >
                    Save Needs Edit
                  </button>
                </div>

                {/* Status Update */}
                <div style={{ ...card, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>
                    Update Status
                  </div>

                  {["pending", "editable", "ready", "sent", "failed"].map(
                    (s) => (
                      <label key={s} style={radioRow}>
                        <input
                          type="radio"
                          name="nextStatus"
                          value={s}
                          defaultChecked={selectedOrder.status === s}
                        />
                        <span style={badge(s)}>{s}</span>
                      </label>
                    ),
                  )}

                  <button
                    type="submit"
                    name="_intent"
                    value="update_status"
                    style={{ ...secondaryBtn, marginTop: 10 }}
                  >
                    Update Status
                  </button>

                  {needsEdit && selectedOrder.status !== "ready" && (
                    <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                      ✳️ Editing required. After editing, set status to{" "}
                      <b>ready</b>.
                    </div>
                  )}
                </div>

                {/* File URL Editor */}
                <div style={{ display: "grid", gap: 12 }}>
                  {items.map((it, idx) => (
                    <div key={idx} style={card}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>
                        {it.productName || `Item ${idx + 1}`}
                      </div>
                      <div style={{ opacity: 0.8, marginTop: 4 }}>
                        Qty: {it.quantity || 1}
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
                              <label style={label}>
                                File URL ({f.type || "file"})
                              </label>
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

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="submit"
                      name="_intent"
                      value="save_editable"
                      style={primaryBtn}
                      title="Saves URLs and marks status as editable"
                    >
                      Save URLs (Editable)
                    </button>

                    <button
                      type="submit"
                      name="_intent"
                      value="send_partner"
                      style={{
                        ...dangerBtn,
                        opacity: canSend ? 1 : 0.5,
                        cursor: canSend ? "pointer" : "not-allowed",
                      }}
                      disabled={!canSend}
                      title={
                        canSend
                          ? "Send order to partner"
                          : needsEdit
                            ? "Editing required. Set status READY first."
                            : "Select an order"
                      }
                    >
                      Send to Partner
                    </button>
                  </div>
                </div>
              </Form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** ✅ Styles */
const styles = {
  container: {
    padding: 20,
    margin: "0 auto",
    fontFamily:
      'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    color: "#111827",
  },

  alertError: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#991b1b",
    fontWeight: 700,
    marginBottom: 12,
  },
  alertOk: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #bbf7d0",
    background: "#f0fdf4",
    color: "#166534",
    fontWeight: 700,
    marginBottom: 12,
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  title: { margin: 0, fontSize: 24, letterSpacing: "-0.2px" },
  subtitle: { margin: "6px 0 0", opacity: 0.8 },

  metaRight: { display: "flex", alignItems: "center", gap: 10 },
  countPill: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    background: "#eef2ff",
    color: "#3730a3",
    border: "1px solid #e5e7eb",
  },

  grid: {
    display: "grid",
    gridTemplateColumns: "1.2fr 1fr",
    gap: 14,
    alignItems: "start",
  },

  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    overflow: "hidden",
    background: "#fff",
    boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
  },

  detailCard: {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    background: "#fff",
    boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
    overflow: "hidden",
  },

  tableWrapper: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse" },

  theadRow: { background: "#f9fafb" },
  th: {
    textAlign: "left",
    padding: "12px 14px",
    borderBottom: "2px solid #e5e7eb",
    fontSize: 12,
    letterSpacing: "0.3px",
    textTransform: "uppercase",
    color: "#374151",
    whiteSpace: "nowrap",
  },

  tr: {},
  td: {
    padding: "12px 14px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: 14,
    verticalAlign: "top",
    whiteSpace: "nowrap",
  },
  tdStrong: {
    padding: "12px 14px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: 14,
    verticalAlign: "top",
    fontWeight: 700,
    color: "#111827",
    whiteSpace: "nowrap",
  },
  tdMuted: {
    padding: "12px 14px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: 14,
    verticalAlign: "top",
    color: "#6b7280",
    whiteSpace: "nowrap",
  },
};

const card = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#fff",
  padding: 14,
};

const radioRow = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  marginBottom: 6,
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

const dangerBtn = {
  background: "#dc2626",
  color: "#fff",
  border: "1px solid #dc2626",
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
  cursor: "pointer",
};

const tinyBtn = {
  marginLeft: "auto",
  border: "1px solid #e5e7eb",
  background: "#fff",
  borderRadius: 10,
  padding: "6px 10px",
  fontWeight: 800,
  cursor: "pointer",
};

const badge = (status) => {
  const base = {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    textTransform: "capitalize",
    border: "1px solid rgba(0,0,0,0.06)",
  };

  if (status === "pending")
    return { ...base, background: "#fef3c7", color: "#92400e" };
  if (status === "editable")
    return { ...base, background: "#dbeafe", color: "#1e40af" };
  if (status === "ready")
    return { ...base, background: "#dcfce7", color: "#166534" };
  if (status === "sent")
    return { ...base, background: "#e0e7ff", color: "#3730a3" };
  if (status === "failed")
    return { ...base, background: "#fee2e2", color: "#991b1b" };

  return { ...base, background: "#e5e7eb", color: "#111827" };
};
