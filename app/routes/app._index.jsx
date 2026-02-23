import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const orders = [];
  let hasNextPage = true;
  let endCursor = null;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
        query getOrders($cursor: String) {
          orders(first: 250, after: $cursor) {
            edges {
              node {
                id
                name
                email
                createdAt
                displayFinancialStatus
                displayFulfillmentStatus
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                subtotalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                totalDiscountsSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                totalShippingPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                totalTaxSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                customer {
                  id
                  firstName
                  lastName
                  email
                  phone
                }
                shippingAddress {
                  firstName
                  lastName
                  address1
                  address2
                  city
                  province
                  country
                  zip
                  phone
                }
                billingAddress {
                  firstName
                  lastName
                  address1
                  address2
                  city
                  province
                  country
                  zip
                  phone
                }
                lineItems(first: 250) {
                  edges {
                    node {
                      id
                      title
                      quantity
                      originalUnitPriceSet {
                        shopMoney {
                          amount
                          currencyCode
                        }
                      }
                      discountedUnitPriceSet {
                        shopMoney {
                          amount
                          currencyCode
                        }
                      }
                      variant {
                        id
                        title
                        sku
                        price
                      }
                      product {
                        id
                        title
                        handle
                      }
                      customAttributes {
                        key
                        value
                      }
                    }
                  }
                }
                customAttributes {
                  key
                  value
                }
                metafields(first: 10) {
                  edges {
                    node {
                      id
                      namespace
                      key
                      value
                    }
                  }
                }
                note
                tags
                cancelledAt
                cancelReason
                fulfillments {
                  id
                  status
                  createdAt
                  trackingInfo {
                    number
                    url
                    company
                  }
                }
                transactions {
                  id
                  kind
                  status
                  amount
                  gateway
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
      { variables: { cursor: endCursor } },
    );

    const responseJson = await response.json();

    if (responseJson.data?.orders) {
      orders.push(...responseJson.data.orders.edges.map((edge) => edge.node));
      hasNextPage = responseJson.data.orders.pageInfo.hasNextPage;
      endCursor = responseJson.data.orders.pageInfo.endCursor;
    } else {
      hasNextPage = false;
    }
  }

  return {
    orders,
    totalOrders: orders.length,
    shop: session.shop,
    accessToken: session.accessToken,
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  // Update order metafield with new image URL
  if (actionType === "updateImage") {
    const orderId = formData.get("orderId");
    const imageUrl = formData.get("imageUrl");

    try {
      const response = await admin.graphql(
        `#graphql
          mutation updateOrderMetafield($input: OrderInput!) {
            orderUpdate(input: $input) {
              order {
                id
                metafields(first: 10) {
                  edges {
                    node {
                      id
                      namespace
                      key
                      value
                    }
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }`,
        {
          variables: {
            input: {
              id: orderId,
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

      if (result.data?.orderUpdate?.userErrors?.length > 0) {
        return {
          success: false,
          error: result.data.orderUpdate.userErrors[0].message,
        };
      }

      return { success: true, orderId, imageUrl };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  return null;
};

// Get image URL from metafield or custom attributes
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

export default function Index() {
  const { orders, totalOrders, shop } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedImage, setSelectedImage] = useState(null);
  const [editModal, setEditModal] = useState({ open: false, order: null });
  const [uploading, setUploading] = useState(false);
  const [localImages, setLocalImages] = useState({});

  const itemsPerPage = 20;

  // ✅ Add this iframe check here
  useEffect(() => {
    if (window.top === window.self) {
      window.location.href = "/auth/login";
    }
  }, []);
  useEffect(() => {
    if (totalOrders > 0) {
      shopify.toast.show(`${totalOrders} orders loaded`);
    }
  }, [totalOrders, shopify]);

  // Handle metafield update response
  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Image updated successfully!");
      setEditModal({ open: false, order: null });
      // Revalidate page to get updated data
      window.location.reload();
    } else if (fetcher.data?.error) {
      shopify.toast.show(`Error: ${fetcher.data.error}`);
    }
  }, [fetcher.data, shopify]);

  // Filter orders based on search term
  const filteredOrders = orders.filter((order) => {
    const search = searchTerm.toLowerCase();
    return (
      order.name?.toLowerCase().includes(search) ||
      order.email?.toLowerCase().includes(search) ||
      order.customer?.firstName?.toLowerCase().includes(search) ||
      order.customer?.lastName?.toLowerCase().includes(search) ||
      order.shippingAddress?.city?.toLowerCase().includes(search)
    );
  });

  // Pagination
  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedOrders = filteredOrders.slice(
    startIndex,
    startIndex + itemsPerPage,
  );

  // Handle file upload to S3
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file
    if (!file.type.startsWith("image/")) {
      shopify.toast.show("Please select an image file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      shopify.toast.show("File size must be less than 10MB");
      return;
    }

    setUploading(true);

    try {
      // Upload to S3
      const formData = new FormData();
      formData.append("file", file);
      formData.append("shop", shop);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (result.success && result.fileUrl) {
        // Update local state immediately for preview
        setLocalImages((prev) => ({
          ...prev,
          [editModal.order.id]: result.fileUrl,
        }));

        // Save to Shopify metafield
        const metafieldForm = new FormData();
        metafieldForm.append("actionType", "updateImage");
        metafieldForm.append("orderId", editModal.order.id);
        metafieldForm.append("imageUrl", result.fileUrl);
        fetcher.submit(metafieldForm, { method: "POST" });
      } else {
        shopify.toast.show(`Upload failed: ${result.error}`);
      }
    } catch (error) {
      shopify.toast.show(`Upload error: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  // Format currency
  const formatMoney = (amount, currency) =>
    `${parseFloat(amount).toFixed(2)} ${currency}`;

  // Status badge component
  const getStatusBadge = (status) => {
    const colors = {
      PAID: { bg: "#d4edda", color: "#155724" },
      PENDING: { bg: "#fff3cd", color: "#856404" },
      REFUNDED: { bg: "#f8d7da", color: "#721c24" },
      FULFILLED: { bg: "#d4edda", color: "#155724" },
      UNFULFILLED: { bg: "#fff3cd", color: "#856404" },
      PARTIALLY_FULFILLED: { bg: "#d1ecf1", color: "#0c5460" },
    };
    const style = colors[status] || { bg: "#e2e3e5", color: "#383d41" };
    return (
      <span
        style={{
          padding: "4px 8px",
          borderRadius: "4px",
          fontSize: "12px",
          fontWeight: "500",
          backgroundColor: style.bg,
          color: style.color,
        }}
      >
        {status || "N/A"}
      </span>
    );
  };

  // Styles
  const styles = {
    container: { padding: "20px", fontFamily: "Arial, sans-serif" },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "20px",
      flexWrap: "wrap",
      gap: "10px",
    },
    title: { margin: 0, fontSize: "24px" },
    searchInput: {
      padding: "10px 15px",
      border: "1px solid #ddd",
      borderRadius: "8px",
      width: "300px",
      fontSize: "14px",
    },
    tableWrapper: {
      overflowX: "auto",
      borderRadius: "8px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      backgroundColor: "#fff",
    },
    th: {
      padding: "12px",
      textAlign: "left",
      borderBottom: "2px solid #dee2e6",
      fontWeight: "600",
      fontSize: "13px",
    },
    td: { padding: "12px", borderBottom: "1px solid #dee2e6" },
    imageContainer: { position: "relative", display: "inline-block" },
    thumbnail: {
      width: "60px",
      height: "60px",
      objectFit: "cover",
      borderRadius: "6px",
      cursor: "pointer",
      border: "1px solid #ddd",
    },
    editBtn: {
      position: "absolute",
      bottom: "-5px",
      right: "-5px",
      width: "24px",
      height: "24px",
      borderRadius: "50%",
      backgroundColor: "#007bff",
      color: "#fff",
      border: "none",
      cursor: "pointer",
      fontSize: "12px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    noImage: {
      width: "60px",
      height: "60px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#f5f5f5",
      borderRadius: "6px",
      color: "#999",
      fontSize: "10px",
      cursor: "pointer",
    },
    updatedBadge: {
      position: "absolute",
      top: "-5px",
      left: "-5px",
      backgroundColor: "#28a745",
      color: "#fff",
      fontSize: "8px",
      padding: "2px 4px",
      borderRadius: "3px",
    },
    modal: {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.8)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
    },
    modalContent: {
      backgroundColor: "#fff",
      padding: "30px",
      borderRadius: "12px",
      maxWidth: "500px",
      width: "90%",
      textAlign: "center",
    },
    modalImage: { maxWidth: "90%", maxHeight: "90%", borderRadius: "8px" },
    closeBtn: {
      position: "absolute",
      top: "20px",
      right: "20px",
      color: "#fff",
      fontSize: "30px",
      cursor: "pointer",
      background: "none",
      border: "none",
    },
    uploadBtn: {
      padding: "12px 24px",
      backgroundColor: "#007bff",
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      marginTop: "15px",
    },
    cancelBtn: {
      padding: "12px 24px",
      backgroundColor: "#6c757d",
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      marginLeft: "10px",
    },
    pagination: {
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      gap: "10px",
      marginTop: "20px",
    },
    pageBtn: {
      padding: "8px 16px",
      border: "1px solid #ddd",
      borderRadius: "4px",
      cursor: "pointer",
      backgroundColor: "#fff",
    },
    pageBtnDisabled: {
      padding: "8px 16px",
      border: "1px solid #ddd",
      borderRadius: "4px",
      cursor: "not-allowed",
      backgroundColor: "#f5f5f5",
    },
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>📦 Orders ({totalOrders})</h1>
        <input
          type="text"
          placeholder="🔍 Search orders..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setCurrentPage(1);
          }}
          style={styles.searchInput}
        />
      </div>

      {/* Table */}
      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr style={{ backgroundColor: "#f8f9fa" }}>
              {[
                "Image",
                "Order",

                "Customer",

                "Items",
                "Total",
                "Payment",
                "Delivery",
              ].map((h) => (
                <th key={h} style={styles.th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedOrders.map((order, index) => {
              const imageData = getImageUrl(order);
              const displayUrl = localImages[order.id] || imageData.url;
              const isUpdated = localImages[order.id] || imageData.isUpdated;

              return (
                <tr
                  key={order.id}
                  style={{
                    backgroundColor: index % 2 === 0 ? "#fff" : "#f8f9fa",
                  }}
                >
                  {/* Image Column */}
                  <td style={styles.td}>
                    <div style={styles.imageContainer}>
                      {isUpdated && (
                        <span style={styles.updatedBadge}>Updated</span>
                      )}
                      {displayUrl ? (
                        <>
                          <img
                            src={displayUrl}
                            alt="Product"
                            style={styles.thumbnail}
                            onClick={() => setSelectedImage(displayUrl)}
                            onError={(e) => {
                              e.target.style.display = "none";
                            }}
                          />
                          <button
                            style={styles.editBtn}
                            onClick={() => setEditModal({ open: true, order })}
                            title="Edit Image"
                          >
                            ✎
                          </button>
                        </>
                      ) : (
                        <div
                          style={styles.noImage}
                          onClick={() => setEditModal({ open: true, order })}
                        >
                          + Add
                        </div>
                      )}
                    </div>
                  </td>
                  {/* Order Info */}
                  <td style={styles.td}>
                    <strong style={{ color: "#007bff" }}>{order.name}</strong>
                    <br />
                    <small style={{ color: "#6c757d" }}>
                      {order.email || "N/A"}
                    </small>
                  </td>
                  {/* Date */}
                  {/* <td style={{ ...styles.td, fontSize: "13px" }}>
                    {formatDate(order.createdAt)}
                  </td> */}
                  {/* Customer */}
                  <td style={styles.td}>
                    <strong>
                      {order.customer
                        ? `${order.customer.firstName || ""} ${order.customer.lastName || ""}`
                        : "Guest"}
                    </strong>
                    <br />
                    <small style={{ color: "#6c757d" }}>
                      {order.customer?.phone ||
                        order.shippingAddress?.phone ||
                        "N/A"}
                    </small>
                  </td>
                  {/* Address */}
                  {/* <td style={{ ...styles.td, fontSize: "13px" }}>
                    {order.shippingAddress ? (
                      <>
                        {order.shippingAddress.address1}
                        <br />
                        <small style={{ color: "#6c757d" }}>
                          {order.shippingAddress.city},{" "}
                          {order.shippingAddress.country}
                        </small>
                      </>
                    ) : (
                      "N/A"
                    )}
                  </td> */}
                  {/* Items */}
                  <td style={styles.td}>
                    {order.lineItems.edges.slice(0, 2).map((item, i) => (
                      <div
                        key={i}
                        style={{ fontSize: "12px", marginBottom: "4px" }}
                      >
                        • {item.node.title} (x{item.node.quantity})
                      </div>
                    ))}
                    {order.lineItems.edges.length > 2 && (
                      <small style={{ color: "#007bff" }}>
                        +{order.lineItems.edges.length - 2} more
                      </small>
                    )}
                  </td>
                  {/* Total */}
                  <td style={styles.td}>
                    <strong>
                      {formatMoney(
                        order.totalPriceSet.shopMoney.amount,
                        order.totalPriceSet.shopMoney.currencyCode,
                      )}
                    </strong>
                  </td>
                  {/* Payment Status */}
                  <td style={styles.td}>
                    {getStatusBadge(order.displayFinancialStatus)}
                  </td>
                  {/* Delivery Status */}
                  <td style={styles.td}>
                    {getStatusBadge(order.displayFulfillmentStatus)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            style={currentPage === 1 ? styles.pageBtnDisabled : styles.pageBtn}
          >
            ← Previous
          </button>
          <span style={{ padding: "8px 16px" }}>
            Page {currentPage} / {totalPages} (Total {filteredOrders.length}{" "}
            orders)
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            style={
              currentPage === totalPages
                ? styles.pageBtnDisabled
                : styles.pageBtn
            }
          >
            Next →
          </button>
        </div>
      )}

      {/* Empty State */}
      {filteredOrders.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px", color: "#6c757d" }}>
          No orders found
        </div>
      )}

      {/* Full Image Preview Modal */}
      {selectedImage && (
        <div style={styles.modal} onClick={() => setSelectedImage(null)}>
          <button
            style={styles.closeBtn}
            onClick={() => setSelectedImage(null)}
          >
            ×
          </button>
          <img src={selectedImage} alt="Full view" style={styles.modalImage} />
        </div>
      )}

      {/* Edit Image Modal */}
      {editModal.open && (
        <div
          style={styles.modal}
          onClick={() =>
            !uploading && setEditModal({ open: false, order: null })
          }
        >
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>📷 Update Image</h2>
            <p style={{ color: "#6c757d" }}>
              Order: <strong>{editModal.order?.name}</strong>
            </p>

            {/* Current Image Preview */}
            {(localImages[editModal.order?.id] ||
              getImageUrl(editModal.order).url) && (
              <div style={{ marginBottom: "20px" }}>
                <p style={{ fontSize: "14px", color: "#666" }}>
                  Current Image:
                </p>
                <img
                  src={
                    localImages[editModal.order?.id] ||
                    getImageUrl(editModal.order).url
                  }
                  alt="Current"
                  style={{
                    maxWidth: "200px",
                    maxHeight: "200px",
                    borderRadius: "8px",
                    border: "1px solid #ddd",
                  }}
                />
              </div>
            )}

            {/* Upload Input */}
            <input
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              disabled={uploading}
              style={{ display: "none" }}
              id="imageUpload"
            />
            <label
              htmlFor="imageUpload"
              style={{
                ...styles.uploadBtn,
                display: "inline-block",
                opacity: uploading ? 0.6 : 1,
              }}
            >
              {uploading ? "⏳ Uploading..." : "📤 Select New Image"}
            </label>
            <button
              style={styles.cancelBtn}
              onClick={() => setEditModal({ open: false, order: null })}
              disabled={uploading}
            >
              Cancel
            </button>

            {/* Upload Progress */}
            {uploading && (
              <div style={{ marginTop: "15px", color: "#007bff" }}>
                Uploading to S3 and saving to Shopify...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
