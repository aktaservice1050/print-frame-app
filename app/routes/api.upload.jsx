// app/routes/api.upload.jsx
import { json } from "@remix-run/node";
import { uploadToS3 } from "../services/s3.server";

export const action = async ({ request }) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const shop = formData.get("shop");

    console.log("📥 File received:", file?.name, file?.size);

    if (!file) {
      return json({ error: "File not found" }, { status: 400, headers });
    }

    // File validation
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return json({ error: "File size max 10MB" }, { status: 400, headers });
    }

    // Buffer convert
    // eslint-disable-next-line no-undef
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileObject = {
      originalname: file.name,
      buffer: buffer,
      mimetype: file.type,
      size: file.size,
    };

    // S3 upload process
    console.log("☁️ Uploading to S3...");
    const folderName = shop
      ? `${shop.replace(".myshopify.com", "")}/uploads`
      : "uploads";
    const result = await uploadToS3(fileObject, folderName);

    if (!result.success) {
      console.error("❌ Upload failed:", result.error);
      return json(
        { error: `Upload failed: ${result.error}` },
        { status: 500, headers },
      );
    }

    console.log("✅ Upload successful!");

    return json(
      {
        success: true,
        fileUrl: result.url,
        fileName: file.name,
        fileSize: file.size,
        message: "File uploaded successfully",
      },
      { headers },
    );
  } catch (error) {
    console.error("💥 Error:", error);
    return json(
      { error: `Server err: ${error.message}` },
      { status: 500, headers },
    );
  }
};

export const loader = async () => {
  return json({
    status: "Upload API is working!",
    endpoint: "/api/upload",
  });
};
