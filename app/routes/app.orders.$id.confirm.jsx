/* eslint-disable no-undef */
import prisma from "../db.server";

const jsonResponse = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });

export const action = async ({ params }) => {
  try {
    const order = await prisma.orderQueue.findUnique({
      where: { id: params.id },
    });

    if (!order) {
      return jsonResponse(
        { ok: false, error: "Order not found" },
        { status: 404 },
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

    // partner API might return non-JSON sometimes
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      await prisma.orderQueue.update({
        where: { id: params.id },
        data: {
          status: "sent",
          partnerApiStatus: res.status,
          partnerApiResponse: data,
        },
      });

      return jsonResponse(
        { ok: true, status: res.status, data },
        { status: 200 },
      );
    }

    await prisma.orderQueue.update({
      where: { id: params.id },
      data: {
        status: "failed",
        partnerApiStatus: res.status,
        partnerApiResponse: data,
      },
    });

    return jsonResponse(
      { ok: false, status: res.status, data },
      { status: 400 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    // Optional: mark failed if you want even on unexpected crash
    // await prisma.orderQueue.update({ where: { id: params.id }, data: { status: "failed" } }).catch(() => {});

    return jsonResponse({ ok: false, error: msg }, { status: 500 });
  }
};
