import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { verifyToken } from "@clerk/backend";

const OWNER_USER_ID = process.env.OWNER_USER_ID;

async function verifyOwner(req) {
  if (!OWNER_USER_ID) return true; // dev mode: no owner set
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    console.log("verifyOwner payload.sub:", payload.sub, "expected:", OWNER_USER_ID);
    return payload.sub === OWNER_USER_ID;
  } catch (e) {
    console.error("verifyToken error:", e.message);
    return false;
  }
}

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

    // POST /api/r2?action=save-project  — owner only, saves project JSON to shared/
    if (req.method === "POST" && action === "save-project") {
      const ok = await verifyOwner(req);
      if (!ok) return res.status(403).json({ error: "Forbidden" });

      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const { projectId, project } = body;
      if (!projectId || !project) return res.status(400).json({ error: "Missing projectId or project" });

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: `shared/${projectId}.json`,
        Body: JSON.stringify(project),
        ContentType: "application/json",
      }));

      return res.status(200).json({ ok: true, key: `shared/${projectId}.json` });
    }

    // GET /api/r2?action=list-shared  — returns all shared project JSONs
    if (req.method === "GET" && action === "list-shared") {
      const listResult = await s3.send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: "shared/",
      }));

      const projects = [];
      for (const obj of (listResult.Contents || [])) {
        if (!obj.Key.endsWith(".json")) continue;
        try {
          const getRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
          const chunks = [];
          for await (const chunk of getRes.Body) chunks.push(chunk);
          const text = Buffer.concat(chunks).toString("utf8");
          projects.push(JSON.parse(text));
        } catch {}
      }

      return res.status(200).json({ projects });
    }

    // DELETE /api/r2?action=delete-shared&projectId=xxx  — owner only
    if (req.method === "DELETE" && action === "delete-shared") {
      const ok = await verifyOwner(req);
      if (!ok) return res.status(403).json({ error: "Forbidden" });

      const { projectId } = req.query;
      if (!projectId) return res.status(400).json({ error: "Missing projectId" });

      await s3.send(new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: `shared/${projectId}.json`,
      }));

      return res.status(200).json({ ok: true, deleted: `shared/${projectId}.json` });
    }

    return res.status(400).json({ error: "Invalid action. Use: upload, get, list, delete, save-project, list-shared, delete-shared" });

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
