// NextFrame Flow — R2 Image Worker
// 部署到 Cloudflare Workers，綁定 R2 bucket "nextframe-flow-assets"
// 功能：上傳圖片、讀取圖片、列出圖片、刪除圖片

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://nextframe-flow.vercel.app",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Filename",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname.slice(1); // remove leading /

    try {
      // PUT /project-id/filename — Upload image
      if (request.method === "PUT" && path) {
        const contentType = request.headers.get("Content-Type") || "image/png";
        const body = await request.arrayBuffer();

        await env.BUCKET.put(path, body, {
          httpMetadata: { contentType },
        });

        return new Response(
          JSON.stringify({ ok: true, key: path, url: `${url.origin}/${path}` }),
          { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      // GET /project-id/filename — Serve image
      if (request.method === "GET" && path && !path.endsWith("/")) {
        const object = await env.BUCKET.get(path);
        if (!object) {
          return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
        }

        const headers = new Headers(CORS_HEADERS);
        object.writeHttpMetadata(headers);
        headers.set("Cache-Control", "public, max-age=31536000, immutable");

        return new Response(object.body, { headers });
      }

      // GET /project-id/ — List images in project
      if (request.method === "GET" && path.endsWith("/")) {
        const listed = await env.BUCKET.list({ prefix: path });
        const keys = listed.objects.map((o) => ({
          key: o.key,
          size: o.size,
          uploaded: o.uploaded,
        }));

        return new Response(JSON.stringify({ keys }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      // DELETE /project-id/filename — Delete image
      if (request.method === "DELETE" && path) {
        await env.BUCKET.delete(path);
        return new Response(
          JSON.stringify({ ok: true, deleted: path }),
          { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      // GET / — Health check
      return new Response(
        JSON.stringify({ service: "NextFrame Flow R2", status: "ok" }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
  },
};
