import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = "nextframe-flow-assets";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  const { action, key, prefix } = req.query;

  try {
    // POST /api/r2?action=upload&key=proj_xxx/image.jpg
    if (req.method === "POST" && action === "upload" && key) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] || "image/png";

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }));

      return res.status(200).json({
        ok: true,
        key,
        url: `/api/r2?action=get&key=${encodeURIComponent(key)}`,
      });
    }

    // GET /api/r2?action=get&key=proj_xxx/image.jpg
    if (req.method === "GET" && action === "get" && key) {
      const obj = await s3.send(new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
      }));

      const chunks = [];
      for await (const chunk of obj.Body) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      res.setHeader("Content-Type", obj.ContentType || "image/png");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.status(200).send(buffer);
    }

    // GET /api/r2?action=list&prefix=proj_xxx/
    if (req.method === "GET" && action === "list") {
      const result = await s3.send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix || "",
      }));

      const keys = (result.Contents || []).map(o => ({
        key: o.Key,
        size: o.Size,
        lastModified: o.LastModified,
      }));

      return res.status(200).json({ keys });
    }

    // DELETE /api/r2?action=delete&key=proj_xxx/image.jpg
    if (req.method === "DELETE" && action === "delete" && key) {
      await s3.send(new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: key,
      }));

      return res.status(200).json({ ok: true, deleted: key });
    }

    return res.status(400).json({ error: "Invalid action. Use: upload, get, list, delete" });

  } catch (err) {
    console.error("R2 API error:", err);
    return res.status(500).json({ error: err.message });
  }
}

export const config = {
  api: {
    bodyParser: false, // We handle raw body for image upload
  },
};
