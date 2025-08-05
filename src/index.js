import html from "./index.html";
import docsHtml from "./docs.html";
import styleCss from "./style.txt";
import { DateTime } from "luxon";
import runJS from "./run.js";
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const KV = env.URLS;

    const API_SECRET = env.API_KEY;
    const cors = getCORSHeaders();

    // --- 0) Ensure KV is bound ---
    if (!KV || typeof KV.get !== "function") {
      return new Response(
        JSON.stringify({
          success: false,
          error: "KV namespace not configured",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...cors },
        },
      );
    }

    // --- 1) Preflight ---
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // --- 2) Static assets ---
    if (path === "/" || path === "") {
      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html", ...cors },
      });
    }
    if (path === "/run.js") {
      return new Response(runJS, {
        status: 200,
        headers: { "Content-Type": "text/javascript", ...cors },
      });
    }
    if (path === "/docs" || path === "/docs/") {
      return new Response(docsHtml, {
        status: 200,
        headers: { "Content-Type": "text/html", ...cors },
      });
    }
    if (path === "/style.css") {
      return new Response(styleCss, {
        status: 200,
        headers: { "Content-Type": "text/css", ...cors },
      });
    }

    // --- 3) API key check (all /api/* except /api/auth) ---
    if (path.startsWith("/api/") && path !== "/api/auth") {
      const auth = request.headers.get("Authorization");
      if (!auth || auth !== `Bearer ${API_SECRET}`) {
        return new Response(
          JSON.stringify({ success: false, error: "Unauthorized" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json", ...cors },
          },
        );
      }
    }

    // --- 4) /api/auth ---
    if (path === "/api/auth") {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    if (path === "/api/create" && method === "POST") {
      const userTZ = request.headers.get("X-Timezone") || "UTC";
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(
          JSON.stringify({ success: false, error: "Invalid JSON" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json", ...cors },
          },
        );
      }
      const { url: targetUrl, expiration, slug, password } = body;
      if (!targetUrl) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing URL" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json", ...cors },
          },
        );
      }

      // 1) Timestamp now and figure out expiresAtUtc
      const now = Date.now();
      let expiresAtUtc, formattedExpiration;
      if (expiration) {
        expiresAtUtc = DateTime.fromFormat(expiration, "yyyy-MM-dd hh:mm a", {
          zone: userTZ,
        }).toMillis();
        formattedExpiration = DateTime.fromMillis(expiresAtUtc, {
          zone: userTZ,
        }).toLocaleString(DateTime.DATETIME_FULL);
      } else {
        expiresAtUtc = null; // never expire
        formattedExpiration = "Never";
      }

      // 2) Format created
      const formattedCreated = DateTime.fromMillis(now, {
        zone: userTZ,
      }).toLocaleString(DateTime.DATETIME_FULL);

      // 3) Build and store
      const key = slug || generateSlug();
      const data = {
        url: targetUrl,
        metadata: {
          createdAtUtc: now,
          formattedCreated,
          expiresAtUtc,
          formattedExpiration,
          passwordProtected: Boolean(password),
        },
        ...(password && { password }),
      };
      await KV.put(key, JSON.stringify(data));

      // 4) Respond
      return new Response(
        JSON.stringify({
          success: true,
          slug: key,
          expirationInSeconds:
            expiresAtUtc === null
              ? null
              : Math.floor((expiresAtUtc - now) / 1000),
          passwordProtected: Boolean(password),
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...cors },
        },
      );
    }

    // --- 6) GET /api/links ---
    if (url.pathname === "/api/links" && request.method === "GET") {
      // 1) load the admin secret and check caller
      const storedSecret = (await KV.get("SUPER_SECRET_KEY")) || "";
      const isSuper = request.headers.get("X-Super-Secret") === storedSecret;
      const now = Date.now();

      // 2) list all keys, but drop the secret entry
      const { keys } = await KV.list();
      const linkKeys = keys.filter((k) => k.name !== "SUPER_SECRET_KEY");

      // 3) build your array of link objects
      const items = await Promise.all(
        linkKeys.map(async ({ name }) => {
          const raw = await KV.get(name);
          if (!raw || raw[0] !== "{") return null; // skip non-JSON entries

          let data;
          try {
            data = JSON.parse(raw);
          } catch {
            return null;
          }
          if (data.metadata.passwordProtected && !isSuper) {
            return null;
          }
          if (
            data.metadata.expiresAtUtc !== null &&
            now >= data.metadata.expiresAtUtc
          ) {
            await KV.delete(name);
            return null;
          }

          // 5) calculate time left
          const expiresAtUtc = data.metadata.expiresAtUtc;
          const expirationInSeconds =
            data.metadata.expiresAtUtc === null
              ? null
              : Math.floor((data.metadata.expiresAtUtc - now) / 1000);
          // 6) assemble the item
          const item = {
            slug: name,
            url: data.url,
            passwordProtected: !!data.metadata.passwordProtected,
            metadata: {
              createdAt: data.metadata.formattedCreated,
              formattedExpiration: data.metadata.formattedExpiration,
              createdAtUtc: data.metadata.createdAtUtc,
              expiresAtUtc,
              expirationInSeconds,
            },
            // only reveal the password if this caller is “super”
            ...(data.metadata.passwordProtected && isSuper
              ? { password: data.password }
              : {}),
          };

          return item;
        }),
      );

      return new Response(JSON.stringify(items.filter(Boolean)), {
        status: 200,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    // --- 7) DELETE /api/delete ---
    if (method === "DELETE" && path.startsWith("/api/")) {
      const slug = path.slice("/api/".length);
      const SUPER_SECRET_KEY = (await KV.get("SUPER_SECRET_KEY")) || "";
      const isSuper =
        request.headers.get("X-Super-Secret") === SUPER_SECRET_KEY;
      if (!isSuper) {
        return new Response(
          JSON.stringify({ success: false, error: "Unauthorized" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json", ...cors },
          },
        );
      }
      if (!slug || typeof slug !== "string") {
        return new Response(
          JSON.stringify({ success: false, error: "Missing slug" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json", ...cors },
          },
        );
      }
      await KV.delete(slug);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    // --- 8) REDIRECT /:slug ---
    if (method === "GET") {
      const slug = path.slice(1);
      if (slug) {
        const raw = await KV.get(slug);
        if (!raw)
          return new Response("Not Found", { status: 404, headers: cors });

        const data = JSON.parse(raw);
        const now = Date.now();

        if (now >= data.metadata.expiresAtUtc) {
          await KV.delete(slug);
          return new Response("Gone", { status: 410, headers: cors });
        }

        // if protected, check password
        if (data.metadata.passwordProtected) {
          const provided = request.headers.get("X-Link-Password") || "";
          if (provided !== data.password) {
            return new Response("Unauthorized", { status: 401, headers: cors });
          }
        }

        // public or (correctly unlocked) → redirect
        return Response.redirect(data.url, 302);
      }
    }

    // --- 9) fallback ---
    return new Response("Not Found", { status: 404, headers: cors });
  },
};

// helper functions
function getCORSHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, X-Super-Secret, X-Link-Password",
    "Access-Control-Max-Age": "86400",
  };
}

function generateSlug() {
  return [...Array(6)].map(() => Math.random().toString(36)[2]).join("");
}
