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
import { authenticate } from "../shopify.server";

/** ✅ Convert id into Shopify GID if needed */
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

/** ✅ get customAttribute by key (label-based; matches your screenshot) */
const getAttr = (customAttributes = [], key) => {
  const k = String(key || "")
    .trim()
    .toLowerCase();
  const found = (customAttributes || []).find(
    (a) =>
      String(a?.key || "")
        .trim()
        .toLowerCase() === k,
  );
  return found ? found.value : null;
};

/** ✅ "Image Editable" is the key in your customAttributes (screenshot) */
const getImageEditableFromOrder = (order) => {
  const edges = order?.lineItems?.edges || [];
  for (const e of edges) {
    const attrs = e?.node?.customAttributes || [];
    const v =
      getAttr(attrs, "Image Editable") ||
      getAttr(attrs, "image_editable") ||
      getAttr(attrs, "editable");
    if (v) return String(v).trim().toLowerCase();
  }
  return null;
};

/** ✅ "File URL" is the key in your customAttributes (screenshot) */
const getFirstFileUrlFromLineItem = (lineItemNode) => {
  const attrs = lineItemNode?.customAttributes || [];
  const v =
    getAttr(attrs, "File URL") ||
    getAttr(attrs, "file_url") ||
    getAttr(attrs, "File Url") ||
    null;
  return v ? String(v).trim() : null;
};

const buildPartnerPayloadFromOrder = (order, updatedImageUrl) => {
  const orderNumber =
    String(order?.name || "")
      .replace("#", "")
      .trim() || "";
  const customerEmail = order?.email || order?.customer?.email || null;

  const rawCurrency = order?.totalPriceSet?.shopMoney?.currencyCode || "USD";
  const currencyMap = { BDT: "USD", INR: "USD", PKR: "USD" };
  const validCurrency = currencyMap[rawCurrency] || rawCurrency;

  const shipping = order?.shippingAddress || null;
  const lineEdges = order?.lineItems?.edges || [];

  return {
    orderType: "order",
    orderReferenceId: orderNumber || String(order?.id || ""),
    customerReferenceId: "InkWorthy",
    currency: validCurrency,
    preventDuplicate: true,
    items: lineEdges.map((edge) => {
      const item = edge?.node || {};
      const attrs = item.customAttributes || [];

      let frameProperties = {
        paper: "standard",
        orientation: "portrait",
        frameType: "classic",
        frameColor: "wood grain",
        matteType: "matting",
        printType: "4×0",
      };

      (attrs || []).forEach((a) => {
        const key = String(a?.key || "").toLowerCase();
        const val = a?.value;

        if (key.includes("paper")) frameProperties.paper = val;
        if (key.includes("orientation")) frameProperties.orientation = val;
        if (key.includes("frame") && key.includes("type"))
          frameProperties.frameType = val;
        if (key.includes("frame") && key.includes("style"))
          frameProperties.frameColor = val;
        if (key.includes("frame") && key.includes("color"))
          frameProperties.frameColor = val;
        if (key.includes("matte")) frameProperties.matteType = val;
        if (key.includes("print")) frameProperties.printType = val;
      });

      const fileCandidates = (attrs || []).filter((a) => {
        const k = String(a?.key || "").toLowerCase();
        return k.includes("file url") || k.includes("certificate");
      });

      const uniqueFiles = [];
      const seenTypes = new Set();

      fileCandidates.forEach((a) => {
        const url = String(a?.value || "");
        const isValidUrl =
          url &&
          (url.startsWith("http://") ||
            url.startsWith("https://") ||
            url.startsWith("//"));
        if (!isValidUrl) return;

        const normalizedUrl = url.startsWith("//") ? `https:${url}` : url;

        const baseType = String(a?.key || "")
          .toLowerCase()
          .includes("certificate")
          ? "certificate"
          : "default";

        let counter = 1;
        let uniqueType = baseType;
        while (seenTypes.has(uniqueType))
          uniqueType = `${baseType}_${counter++}`;

        seenTypes.add(uniqueType);
        uniqueFiles.push({ type: uniqueType, url: normalizedUrl });
      });

      // ✅ override default file urls if edited image exists
      if (updatedImageUrl) {
        uniqueFiles.forEach((f) => {
          const t = String(f.type || "").toLowerCase();
          if (t.startsWith("default")) f.url = updatedImageUrl;
        });
      }

      const metadata = (attrs || [])
        .filter((a) => {
          const k = String(a?.key || "").toLowerCase();
          return !k.includes("file url") && !k.includes("certificate");
        })
        .map((a) => ({ key: a?.key, value: a?.value }));

      return {
        itemReferenceId:
          item?.variant?.id?.toString() ||
          item?.product?.id?.toString() ||
          item?.id?.toString() ||
          "",
        productName: item.title || "",
        productVariant: {
          paper: frameProperties.paper,
          orientation: frameProperties.orientation,
          frameType: frameProperties.frameType,
          frameColor: frameProperties.frameColor,
          matteType: frameProperties.matteType,
          print_type: frameProperties.printType,
        },
        files: uniqueFiles,
        quantity: item.quantity || 1,
        metadata,
      };
    }),
    shipmentMethodId: "usps_ground_advantage",
    shippingAddress: shipping
      ? {
          companyName: shipping.company || "",
          firstName: shipping.firstName || "",
          lastName: shipping.lastName || "",
          addressLine1: shipping.address1 || "",
          addressLine2: shipping.address2 || "",
          city: shipping.city || "",
          postcode: shipping.zip || "",
          country: shipping.countryCodeV2 || "US",
          email: customerEmail,
          phone: shipping.phone || "",
        }
      : null,
  };
};

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const orderIdRaw = url.searchParams.get("orderId");
  const orderId = orderIdRaw ? toOrderGid(orderIdRaw) : null;

  const resp = await admin.graphql(
    `#graphql
    query OrdersForReview($first:Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            email
            createdAt
            totalPriceSet { shopMoney { amount currencyCode } }
            shippingAddress {
              firstName lastName company address1 address2 city zip
              countryCodeV2 phone
            }
            updated_image: metafield(namespace: "custom", key: "updated_image") { value }
            partner_status: metafield(namespace: "custom", key: "partner_status") { value }
            partner_api_status: metafield(namespace: "custom", key: "partner_api_status") { value }
            lineItems(first: 25) {
              edges {
                node {
                  id
                  title
                  quantity
                  product { id }
                  variant { id }
                  customAttributes { key value }
                }
              }
            }
          }
        }
      }
    }`,
    { variables: { first: 200 } },
  );

  const data = await resp.json();
  const edges = data?.data?.orders?.edges || [];

  const orders = edges.map((e) => {
    const o = e.node;
    const imageEditable = getImageEditableFromOrder(o);
    return {
      id: o.id,
      name: o.name,
      email: o.email,
      createdAt: o.createdAt,
      total: o.totalPriceSet?.shopMoney?.amount || null,
      currency: o.totalPriceSet?.shopMoney?.currencyCode || null,
      imageEditable,
      partnerStatus: o?.partner_status?.value || null,
      partnerApiStatus: o?.partner_api_status?.value || null,
      updatedImage: o?.updated_image?.value || null,
    };
  });

  let selectedOrder = null;
  if (orderId) {
    const r2 = await admin.graphql(
      `#graphql
      query OrderById($id: ID!) {
        order(id: $id) {
          id
          name
          email
          createdAt
          totalPriceSet { shopMoney { amount currencyCode } }
          shippingAddress {
            firstName lastName company address1 address2 city zip
            countryCodeV2 phone
          }
          updated_image: metafield(namespace: "custom", key: "updated_image") { value }
          partner_status: metafield(namespace: "custom", key: "partner_status") { value }
          partner_api_status: metafield(namespace: "custom", key: "partner_api_status") { value }
          partner_api_response: metafield(namespace: "custom", key: "partner_api_response") { value }
          lineItems(first: 25) {
            edges {
              node {
                id
                title
                quantity
                product { id }
                variant { id }
                customAttributes { key value }
              }
            }
          }
        }
      }`,
      { variables: { id: orderId } },
    );

    const j2 = await r2.json();
    selectedOrder = j2?.data?.order || null;
  }

  return { orders, selectedOrder, orderId, shop: session.shop };
};

export const action = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);
    const form = await request.formData();
    const intent = String(form.get("_intent") || "");

    if (intent === "update_image_metafield") {
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
        mutation updateOrderMetafields($input: OrderInput!) {
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
                {
                  namespace: "custom",
                  key: "partner_status",
                  value: "edited",
                  type: "single_line_text_field",
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

    if (intent === "send_partner") {
      const orderIdRaw = String(form.get("orderId") || "");
      const orderId = toOrderGid(orderIdRaw);

      if (!orderId) {
        return jsonResponse(
          { ok: false, error: "Missing orderId" },
          { status: 400 },
        );
      }

      const r = await admin.graphql(
        `#graphql
        query OrderForPartner($id: ID!) {
          order(id: $id) {
            id
            name
            email
            totalPriceSet { shopMoney { amount currencyCode } }
            shippingAddress {
              firstName lastName company address1 address2 city zip
              countryCodeV2 phone
            }
            updated_image: metafield(namespace: "custom", key: "updated_image") { value }
            lineItems(first: 25) {
              edges {
                node {
                  id
                  title
                  quantity
                  product { id }
                  variant { id }
                  customAttributes { key value }
                }
              }
            }
          }
        }`,
        { variables: { id: orderId } },
      );

      const j = await r.json();
      const order = j?.data?.order;

      if (!order) {
        return jsonResponse(
          { ok: false, error: "Order not found" },
          { status: 404 },
        );
      }

      const imageEditable = getImageEditableFromOrder(order);
      if (imageEditable !== "editable") {
        return jsonResponse(
          {
            ok: false,
            error:
              "This order is not editable (or missing “Image Editable”). It should be auto-sent by webhook.",
          },
          { status: 400 },
        );
      }

      const updatedImageUrl = order?.updated_image?.value || null;
      const partnerPayload = buildPartnerPayloadFromOrder(
        order,
        updatedImageUrl,
      );

      // ✅ hardcoded URL (your requirement)
      const partnerApiUrl =
        "https://api.partner-connect.io/api/hud/6eb5f69f-9d04-4662-859b-0ad826660d5b/order";

      const PARTNER_API_KEY =
        "ygMsrjnwsQZBMUlK:cTRqd1RyV0izCaBr9t8qBUXp3R5hjHT6";

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 10000);

      let res;
      let text = "";
      let parsed = null;

      try {
        res = await fetch(partnerApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": PARTNER_API_KEY, // ✅ send header too
          },
          body: JSON.stringify(partnerPayload),
          signal: controller.signal,
        });

        text = await res.text().catch(() => "");
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
      } catch (err) {
        const msg =
          err?.name === "AbortError"
            ? "Partner request timeout"
            : String(err?.message || err);

        return jsonResponse(
          {
            ok: false,
            error: msg,
            debug: {
              partnerApiUrl,
              orderId,
              orderName: order?.name,
              updatedImageUrl,
              payloadPreview: {
                orderReferenceId: partnerPayload?.orderReferenceId,
                items: partnerPayload?.items?.map((it) => ({
                  productName: it.productName,
                  quantity: it.quantity,
                  files: it.files?.map((f) => ({ type: f.type, url: f.url })),
                })),
              },
            },
          },
          { status: 400 },
        );
      } finally {
        clearTimeout(t);
      }

      const statusValue = res.ok ? "sent" : "failed";

      await admin.graphql(
        `#graphql
        mutation savePartnerMetafields($input: OrderInput!) {
          orderUpdate(input: $input) {
            order { id }
            userErrors { field message }
          }
        }`,
        {
          variables: {
            input: {
              id: orderId,
              metafields: [
                {
                  namespace: "custom",
                  key: "partner_status",
                  value: statusValue,
                  type: "single_line_text_field",
                },
                {
                  namespace: "custom",
                  key: "partner_api_status",
                  value: String(res.status),
                  type: "number_integer",
                },
                {
                  namespace: "custom",
                  key: "partner_api_response",
                  value: text ? text.slice(0, 50000) : "",
                  type: "json",
                },
              ],
            },
          },
        },
      );

      if (!res.ok) {
        return jsonResponse(
          {
            ok: false,
            error: `Partner API failed (${res.status})`,
            partner: { status: res.status, body: parsed || text || null },
            debug: {
              partnerApiUrl,
              orderId,
              orderName: order?.name,
              updatedImageUrl,
              payloadPreview: {
                orderReferenceId: partnerPayload?.orderReferenceId,
                items: partnerPayload?.items?.map((it) => ({
                  productName: it.productName,
                  quantity: it.quantity,
                  files: it.files?.map((f) => ({ type: f.type, url: f.url })),
                })),
              },
            },
          },
          { status: 400 },
        );
      }

      return jsonResponse(
        {
          ok: true,
          message: "Sent to partner",
          partner: { status: res.status, body: parsed || text || null },
        },
        { status: 200 },
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

  const selectOrder = (gid) => {
    const next = new URLSearchParams(sp);
    next.set("orderId", gid);
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

  const imageEditable = selectedOrder
    ? getImageEditableFromOrder(selectedOrder)
    : null;
  const updatedImageUrl = selectedOrder?.updated_image?.value || null;

  const shopifyOrderId = toOrderGid(selectedOrder?.id);
  const lineEdges = selectedOrder?.lineItems?.edges || [];
  const canSend = !!selectedOrder && imageEditable === "editable";
  console.log("first", orders);
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Order Review</h1>
          <p style={styles.subtitle}>
            Editable → upload/edit → Send to Partner | Not editable → webhook
            auto send
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

      {uploadErr && <div style={styles.alertError}>{uploadErr}</div>}
      {uploadMsg && <div style={styles.alertOk}>{uploadMsg}</div>}

      <div style={styles.grid}>
        <div style={styles.card}>
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.theadRow}>
                  {[
                    "Pick",
                    "Type",
                    "Order #",
                    "Email",
                    "Partner",
                    "Created",
                  ].map((h) => (
                    <th key={h} style={styles.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(orders || [])
                  .filter((o) => o.imageEditable !== "not_editable")
                  .filter((o) => o.partnerStatus !== "sent")
                  .map((o, idx) => {
                    const type =
                      o.imageEditable === "not_editable"
                        ? "auto/direct"
                        : "editable";
                    const p = o.partnerStatus || "-";
                    return (
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
                          <span
                            style={badge(
                              type === "editable" ? "editable" : "auto",
                            )}
                          >
                            {type}
                          </span>
                        </td>
                        <td style={styles.tdStrong}>{o.name || "-"}</td>
                        <td style={styles.tdMuted}>{o.email || "-"}</td>
                        <td style={styles.tdMuted}>{p}</td>
                        <td style={styles.tdMuted}>
                          {o.createdAt
                            ? new Date(o.createdAt).toLocaleString()
                            : "-"}
                        </td>
                      </tr>
                    );
                  })}

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

        <div style={styles.detailCard}>
          {!selectedOrder ? (
            <div style={{ padding: 16, opacity: 0.8 }}>
              Select an order to review.
            </div>
          ) : (
            <div style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>
                  {selectedOrder.name}
                </h2>

                <span style={badge(canSend ? "editable" : "auto")}>
                  {imageEditable === "editable" ? "editable" : "auto/direct"}
                </span>

                <button type="button" onClick={clearSelection} style={tinyBtn}>
                  Clear
                </button>
              </div>

              <div style={{ height: 10 }} />

              {!canSend && (
                <div style={styles.alertError}>
                  This order is <b>not_editable</b> (or missing “Image
                  Editable”). Webhook should auto-send it. This page is mainly
                  for editable orders.
                </div>
              )}

              <div style={{ ...card, padding: 12, marginBottom: 12 }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>
                  Updated Image (Metafield)
                </div>
                <div style={{ fontSize: 13, opacity: 0.8 }}>
                  Metafield: <b>custom.updated_image</b>
                </div>
                <div style={{ height: 10 }} />
                {updatedImageUrl ? (
                  <div style={previewWrap}>
                    <img
                      src={updatedImageUrl}
                      alt="updated preview"
                      style={previewImg}
                      onClick={() => window.open(updatedImageUrl, "_blank")}
                    />
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      Click preview
                    </div>
                  </div>
                ) : (
                  <div style={previewPlaceholder}>No updated image yet</div>
                )}
              </div>

              <Form method="post">
                <input type="hidden" name="orderId" value={selectedOrder.id} />

                <div style={{ display: "grid", gap: 12 }}>
                  {lineEdges.map((edge, idx) => {
                    const it = edge.node;
                    const key = `${idx}`;
                    const original = getFirstFileUrlFromLineItem(it);
                    const previewUrl =
                      previews[key] || updatedImageUrl || original || "";

                    return (
                      <div key={it.id} style={card}>
                        <div style={{ fontWeight: 800 }}>
                          {it.title || `Item ${idx + 1}`}
                        </div>
                        <div style={{ opacity: 0.8, marginTop: 4 }}>
                          Qty: {it.quantity || 1}
                        </div>

                        <div style={{ height: 10 }} />

                        <div style={fileBlock}>
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
                                Preview (updated_image first)
                              </div>
                            </div>
                          ) : (
                            <div style={previewPlaceholder}>No preview</div>
                          )}

                          <label style={label}>
                            Set updated image (custom.updated_image)
                          </label>

                          <div
                            style={{
                              display: "flex",
                              gap: 10,
                              alignItems: "center",
                            }}
                          >
                            <input
                              id={`url-${idx}`}
                              defaultValue={updatedImageUrl || ""}
                              placeholder="https://... (saved as custom.updated_image)"
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
                              inputId={`url-${idx}`}
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

                          <div
                            style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}
                          >
                            Original File URL: {original || "—"}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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
const dangerBtn = {
  background: "#dc2626",
  color: "#fff",
  border: "1px solid #dc2626",
  borderRadius: 10,
  padding: "10px 14px",
  fontWeight: 800,
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
  if (status === "editable")
    return { ...base, background: "#dbeafe", color: "#1e40af" };
  if (status === "auto")
    return { ...base, background: "#dcfce7", color: "#166534" };
  return { ...base, background: "#e5e7eb", color: "#111827" };
};
