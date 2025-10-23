// app/services/s3.server.js
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

console.log("🔧 S3 Service Loading...");

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "eu-north-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.AWS_BUCKET_NAME || "monyr-image-bucket";

console.log("✅ S3 Client initialized");
console.log("📍 Region:", process.env.AWS_REGION);
console.log("🪣 Bucket:", BUCKET_NAME);

export async function uploadToS3(file, folder = "uploads") {
  try {
    console.log("📤 Starting S3 upload...");

    const fileName = `${folder}/${Date.now()}-${file.originalname}`;

    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: "public-read",
    };

    console.log("⬆️ Uploading to S3:", fileName);

    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);

    const fileUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

    console.log("✅ S3 Upload successful:", fileUrl);

    return {
      success: true,
      url: fileUrl,
      key: fileName,
    };
  } catch (error) {
    console.error("❌ S3 Upload Error:");
    console.error("Name:", error.name);
    console.error("Message:", error.message);
    console.error("Code:", error.code);

    return {
      success: false,
      error: error.message,
    };
  }
}
