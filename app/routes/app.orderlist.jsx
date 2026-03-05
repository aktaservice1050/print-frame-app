/* eslint-disable no-undef */
/* eslint-disable react/prop-types */

import { useAppBridge } from "@shopify/app-bridge-react";
import React from "react";
import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useRevalidator,
  useSearchParams,
} from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

/**
 * ✅ Convert stored DB id into Shopify GID if needed
 * - If already gid://shopify/Order/... return as-is
 * - If numeric/string numeric => convert to gid
 */
const toOrderGid = (id) => {
  if (!id) return "";
  const str = String(id);
  if (str.startsWith("gid://shopify/Order/")) return str;
  if (/^\d+$/.test(str)) return `gid://shopify/Order/${str}`;
  return str;
};

/** helper */
const jsonResponse = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");

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

  return { orders, selectedOrder, orderId, shop: session.shop };
};

export const action = async ({ request }) => {
  try {
    const form = await request.formData();
    const intent = String(form.get("_intent") || "");

    // ✅ UPDATE SHOPIFY METAFIELD (this makes Home route sync)
    if (intent === "update_image_metafield") {
      const { admin } = await authenticate.admin(request);

      const shopifyOrderIdRaw = String(form.get("shopifyOrderId") || "");
      const shopifyOrderId = toOrderGid(shopifyOrderIdRaw);
      const imageUrl = String(form.get("imageUrl") || "");

      if (!shopifyOrderId || !imageUrl) {
        return jsonResponse(
          { ok: false, error: "Missing shopifyOrderId or imageUrl" },
          { status: 400 },
        );
      }

      const response = await admin.graphql(
        `#graphql
        mutation updateOrderMetafield($input: OrderInput!) {
          orderUpdate(input: $input) {
            order { id }
            userErrors { field message }
          }
        }`,
        {
          variables: {
            input: {
              id: shopifyOrderId,
              metafields: [
                {
                  namespace: "custom",
                  key: "updated_image",
                  value: imageUrl,
                  type: "url",
                },
              ],
            },
          },
        },
      );

      const result = await response.json();
      const userErrors = result?.data?.orderUpdate?.userErrors || [];
      if (userErrors.length) {
        return jsonResponse(
          { ok: false, error: userErrors[0].message },
          { status: 400 },
        );
      }

      return jsonResponse({ ok: true, intent }, { status: 200 });
    }

    // everything else needs prisma orderId
    const orderId = String(form.get("orderId") || "");
    if (!orderId)
      return jsonResponse(
        { ok: false, error: "Missing orderId" },
        { status: 400 },
      );

    const order = await prisma.orderQueue.findUnique({
      where: { id: orderId },
    });
    if (!order)
      return jsonResponse(
        { ok: false, error: "Order not found" },
        { status: 404 },
      );

    if (intent === "set_needs_edit") {
      const v = String(form.get("needsEdit") || "false") === "true";
      const nextStatus = v ? "editable" : "pending";
      await prisma.orderQueue.update({
        where: { id: orderId },
        data: { needsEdit: v, status: nextStatus },
      });
      return jsonResponse({ ok: true, intent }, { status: 200 });
    }

    if (intent === "save_editable") {
      const payload = order.partnerPayload || {};
      const items = payload.items || [];

      items.forEach((it, idx) => {
        const files = it.files || [];
        files.forEach((f, fIdx) => {
          const key = `fileUrl__${idx}__${fIdx}`;
          const newUrl = form.get(key);
          if (typeof newUrl === "string" && newUrl.trim())
            f.url = newUrl.trim();
        });
      });

      payload.items = items;

      await prisma.orderQueue.update({
        where: { id: orderId },
        data: { partnerPayload: payload, status: "editable" },
      });

      return jsonResponse({ ok: true, intent }, { status: 200 });
    }

    if (intent === "update_status") {
      const nextStatus = String(form.get("nextStatus") || "").trim();
      const allowed = new Set([
        "pending",
        "editable",
        "ready",
        "sent",
        "failed",
      ]);
      if (!allowed.has(nextStatus))
        return jsonResponse(
          { ok: false, error: "Invalid status" },
          { status: 400 },
        );

      await prisma.orderQueue.update({
        where: { id: orderId },
        data: { status: nextStatus },
      });
      return jsonResponse({ ok: true, intent }, { status: 200 });
    }

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
        return jsonResponse({ ok: true, intent }, { status: 200 });
      }

      await prisma.orderQueue.update({
        where: { id: orderId },
        data: {
          status: "failed",
          partnerApiStatus: res.status,
          partnerApiResponse: data,
        },
      });

      return jsonResponse({ ok: false, intent }, { status: 400 });
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

function UploadAndSaveImage({
  shop,
  shopify,
  fetcher,
  inputId,
  shopifyOrderId,
  onPreview,
  onSuccessMsg,
  onErrorMsg,
}) {
  const fileRef = React.useRef(null);
  const [uploading, setUploading] = React.useState(false);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      shopify.toast.show("Please select an image file");
      e.target.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      shopify.toast.show("File size must be less than 10MB");
      e.target.value = "";
      return;
    }

    // ✅ Safety: need GID for metafield update
    if (!shopifyOrderId) {
      const msg = "Missing Shopify Order GID (gid://shopify/Order/...)";
      shopify.toast.show(msg);
      onErrorMsg?.(msg);
      e.target.value = "";
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("shop", shop);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();

      if (result.success && result.fileUrl) {
        onPreview?.(result.fileUrl);
        const el = document.getElementById(inputId);
        if (el) el.value = result.fileUrl;

        // ✅ Metafield update => HOME sync (same as Home route flow)
        const mf = new FormData();
        mf.append("_intent", "update_image_metafield");
        mf.append("shopifyOrderId", shopifyOrderId);
        mf.append("imageUrl", result.fileUrl);
        fetcher.submit(mf, { method: "POST" });

        shopify.toast.show("✅ Image uploaded & saved!");
        onSuccessMsg?.("✅ Image uploaded & saved!");
      } else {
        const msg = `Upload failed: ${result.error || "Unknown error"}`;
        shopify.toast.show(msg);
        onErrorMsg?.(msg);
      }
    } catch (error) {
      const msg = `Upload error: ${error.message}`;
      shopify.toast.show(msg);
      onErrorMsg?.(msg);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={handleFileUpload}
        disabled={uploading}
        style={{ display: "none" }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        style={{
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid #d1d5db",
          background: "#fff",
          fontWeight: 800,
          cursor: uploading ? "not-allowed" : "pointer",
          opacity: uploading ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {uploading ? "Uploading..." : "Upload"}
      </button>
    </>
  );
}

const getImageUrl = (order) => {
  // First check metafield for updated image
  const metafieldImage = order.metafields?.edges?.find(
    (edge) =>
      edge.node.namespace === "custom" && edge.node.key === "updated_image",
  );
  if (metafieldImage) {
    return { url: metafieldImage.node.value, isUpdated: true };
  }

  // Fallback to original custom attribute
  const firstLineItem = order.lineItems.edges[0]?.node;
  const fileUrlAttr = firstLineItem?.customAttributes?.find(
    (attr) => attr.key === "File URL" || attr.key === "_file_url",
  );

  return { url: fileUrlAttr?.value || null, isUpdated: false };
};

export default function OrderReviewSinglePage() {
  const { orders, selectedOrder, orderId, shop } = useLoaderData();
  const actionData = useActionData();
  const revalidator = useRevalidator();
  const [sp, setSp] = useSearchParams();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [uploadMsg, setUploadMsg] = React.useState("");
  const [uploadErr, setUploadErr] = React.useState("");
  const [previews, setPreviews] = React.useState({});

  React.useEffect(() => {
    if (actionData?.ok) revalidator.revalidate();
  }, [actionData, revalidator]);

  React.useEffect(() => {
    if (!uploadMsg && !uploadErr) return;
    const t = setTimeout(() => {
      setUploadMsg("");
      setUploadErr("");
    }, 2600);
    return () => clearTimeout(t);
  }, [uploadMsg, uploadErr]);

  const selectOrder = (id) => {
    const next = new URLSearchParams(sp);
    next.set("orderId", id);
    setSp(next);
    setUploadMsg("");
    setUploadErr("");
    setPreviews({});
  };

  const clearSelection = () => {
    const next = new URLSearchParams(sp);
    next.delete("orderId");
    setSp(next);
    setUploadMsg("");
    setUploadErr("");
    setPreviews({});
  };

  const payload = selectedOrder?.partnerPayload || {};
  const items = payload.items || [];

  const needsEdit = !!selectedOrder?.needsEdit;
  const canSend =
    !!selectedOrder && (!needsEdit || selectedOrder.status === "ready");

  // ✅ Always convert to GID (important for metafield update)
  const shopifyOrderId = toOrderGid(selectedOrder?.shopifyOrderId);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Order Review Queue</h1>
          <p style={styles.subtitle}>Review + Upload + Update</p>
        </div>
        <div style={styles.metaRight}>
          <span style={styles.countPill}>Total: {orders?.length ?? 0}</span>
        </div>
      </div>

      {actionData?.ok === false && actionData?.error && (
        <div style={styles.alertError}>{actionData.error}</div>
      )}
      {actionData?.ok === true && <div style={styles.alertOk}>Saved ✅</div>}

      {uploadErr && <div style={styles.alertError}>{uploadErr}</div>}
      {uploadMsg && <div style={styles.alertOk}>{uploadMsg}</div>}

      <div style={styles.grid}>
        {/* LEFT */}
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
                      backgroundColor: idx % 2 === 0 ? "#fff" : "#f9fafb",
                      cursor: "pointer",
                    }}
                    onClick={() => selectOrder(o.id)}
                  >
                    <td style={styles.td}>
                      <input
                        type="radio"
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
                    <td style={{ padding: 18 }} colSpan={6}>
                      No orders.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT */}
        <div style={styles.detailCard}>
          {!selectedOrder ? (
            <div style={{ padding: 16, opacity: 0.8 }}>
              Select an order to review.
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

              {!shopifyOrderId && (
                <div style={styles.alertError}>
                  (DB) Missing shopifyOrderId (gid://shopify/Order/...) or
                  invalid
                </div>
              )}

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

                {/* Status */}
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
                </div>

                {/* Files */}
                <div style={{ display: "grid", gap: 12 }}>
                  {items.map((it, idx) => (
                    <div key={idx} style={card}>
                      <div style={{ fontWeight: 800 }}>
                        {it.productName || `Item ${idx + 1}`}
                      </div>
                      <div style={{ opacity: 0.8, marginTop: 4 }}>
                        Qty: {it.quantity || 1}
                      </div>

                      <div style={{ height: 10 }} />

                      <div style={{ display: "grid", gap: 12 }}>
                        {(it.files || []).map((f, fIdx) => {
                          const inputName = `fileUrl__${idx}__${fIdx}`;
                          const inputId = `url-${idx}-${fIdx}`;
                          const key = `${idx}__${fIdx}`;
                          const previewUrl = previews[key] || f.url || "";

                          return (
                            <div key={fIdx} style={fileBlock}>
                              {previewUrl ? (
                                <div style={previewWrap}>
                                  <img
                                    src={previewUrl}
                                    alt="preview"
                                    style={previewImg}
                                    onClick={() =>
                                      window.open(previewUrl, "_blank")
                                    }
                                  />
                                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                                    Preview (click)
                                  </div>
                                </div>
                              ) : (
                                <div style={previewPlaceholder}>No preview</div>
                              )}

                              <label style={label}>File URL</label>

                              <div
                                style={{
                                  display: "flex",
                                  gap: 10,
                                  alignItems: "center",
                                }}
                              >
                                <input
                                  id={inputId}
                                  name={inputName}
                                  defaultValue={f.url || ""}
                                  placeholder="https://..."
                                  style={input}
                                  onChange={(e) =>
                                    setPreviews((p) => ({
                                      ...p,
                                      [key]: e.target.value,
                                    }))
                                  }
                                />

                                <UploadAndSaveImage
                                  shop={shop}
                                  shopify={shopify}
                                  fetcher={fetcher}
                                  inputId={inputId}
                                  shopifyOrderId={shopifyOrderId}
                                  onPreview={(url) =>
                                    setPreviews((p) => ({ ...p, [key]: url }))
                                  }
                                  onSuccessMsg={(m) => {
                                    setUploadErr("");
                                    setUploadMsg(m);
                                  }}
                                  onErrorMsg={(m) => {
                                    setUploadMsg("");
                                    setUploadErr(m);
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="submit"
                      name="_intent"
                      value="save_editable"
                      style={primaryBtn}
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

/** styles */
const styles = {
  container: { padding: 20, fontFamily: "system-ui", color: "#111827" },
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
  title: { margin: 0, fontSize: 24 },
  subtitle: { margin: "6px 0 0", opacity: 0.8 },
  metaRight: { display: "flex", alignItems: "center", gap: 10 },
  countPill: {
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
    textTransform: "uppercase",
    color: "#374151",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "12px 14px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: 14,
    whiteSpace: "nowrap",
  },
  tdStrong: {
    padding: "12px 14px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: 14,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  tdMuted: {
    padding: "12px 14px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: 14,
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
  border: "1px solid #d1d5db",
  borderRadius: 10,
  padding: "10px 14px",
  fontWeight: 800,
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

const fileBlock = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 12,
  background: "#fafafa",
};
const previewWrap = {
  marginBottom: 10,
  display: "flex",
  alignItems: "center",
  gap: 10,
};
const previewImg = {
  width: 72,
  height: 72,
  objectFit: "cover",
  borderRadius: 10,
  border: "1px solid #ddd",
  cursor: "pointer",
  background: "#fff",
};
const previewPlaceholder = {
  marginBottom: 10,
  width: 72,
  height: 72,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 10,
  border: "1px dashed #cbd5e1",
  color: "#64748b",
  background: "#fff",
  fontSize: 12,
};

const badge = (status) => {
  const base = {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    textTransform: "capitalize",
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
