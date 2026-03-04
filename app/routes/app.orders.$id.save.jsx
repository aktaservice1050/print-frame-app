import prisma from "../db.server";

export const action = async ({ request, params }) => {
  const form = await request.formData();

  const order = await prisma.orderQueue.findUnique({
    where: { id: params.id },
  });
  if (!order) return ({ ok: false, error: "Order not found" }, { status: 404 });

  const payload = order.partnerPayload;
  const items = payload?.items || [];

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

  return { ok: true };
};
