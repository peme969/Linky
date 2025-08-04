import html from './index.html';
import docsHtml from './docs.html';
import styleCss from './style.txt';
import { DateTime } from 'luxon';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const KV = env.URLS;

    const API_SECRET = env.API_KEY;
    const cors = getCORSHeaders();

    // --- 0) Ensure KV is bound ---
    if (!KV || typeof KV.get !== 'function') {
      return new Response(
        JSON.stringify({ success: false, error: 'KV namespace not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    // --- 1) Preflight ---
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // --- 2) Static assets ---
    if (path === '/' || path === '') {
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html', ...cors } });
    }
    if (path === '/docs' || path === '/docs/') {
      return new Response(docsHtml, { status: 200, headers: { 'Content-Type': 'text/html', ...cors } });
    }
    if (path === '/style.css') {
      return new Response(styleCss, { status: 200, headers: { 'Content-Type': 'text/css', ...cors } });
    }

    // --- 3) API key check (all /api/* except /api/auth) ---
    if (path.startsWith('/api/') && path !== '/api/auth') {
      const auth = request.headers.get('Authorization');
      if (!auth || auth !== `Bearer ${API_SECRET}`) {
        return new Response(
          JSON.stringify({ success: false, error: 'Unauthorized' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...cors } }
        );
      }
    }

    // --- 4) /api/auth ---
    if (path === '/api/auth') {
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    // --- 5) POST /api/create ---
    if (path === '/api/create' && method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid JSON' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...cors } }
        );
      }
      const { url: targetUrl, expiration, slug, password } = body;
      if (!targetUrl) {
        return new Response(
          JSON.stringify({ success: false, error: 'Missing URL' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...cors } }
        );
      }

      // parse or default expiration
      const userTZ = (request.cf && request.cf.timezone) || 'America/Chicago';
      const dtExpires = expiration
        ? DateTime.fromFormat(expiration, 'yyyy-MM-dd hh:mm a', { zone: userTZ })
        : DateTime.now().plus({ days: 365 });
      if (!dtExpires.isValid) {
        return new Response(
          JSON.stringify({ success: false, error: 'Bad expiration format' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...cors } }
        );
      }

      const expiresAtUtc = dtExpires.toUTC().toMillis();
      const now = Date.now();
      const dtCreated = DateTime.fromMillis(now).setZone(userTZ);
      const formattedCreated = dtCreated.toLocaleString(DateTime.DATETIME_FULL);
      const formattedExpiration = dtExpires.toLocaleString(DateTime.DATETIME_FULL);
      const key = slug || generateSlug();

      // build store object
      const data = {
        url: targetUrl,
        metadata: {
          expiresAtUtc,
          formattedCreated,
          formattedExpiration,
          passwordProtected: Boolean(password)
        }
      };
      if (password) data.password = password;

      await KV.put(key, JSON.stringify(data));

      return new Response(
        JSON.stringify({
          success: true,
          slug: key,
          expirationInSeconds: Math.floor((expiresAtUtc - now) / 1000),
          passwordProtected: Boolean(password)
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    // --- 6) GET /api/links ---
    if (path === '/api/links' && method === 'GET') {
      const SUPER_SECRET_KEY = await KV.get('SUPER_SECRET_KEY') || '';
      const isSuper = request.headers.get('X-Super-Secret') === SUPER_SECRET_KEY;
      const now = Date.now();
      const list = await KV.list();
      const linkKeys = list.keys.filter(k => k.name !== 'SUPER_SECRET_KEY');
      const items = await Promise.all(linkKeys.map(async k => {
        const raw = await KV.get(k.name);
        const data = JSON.parse(raw);
        if (!raw) return null;
        if (data.metadata.expiresAtUtc <= now) {
          await KV.delete(k.name);
          return null;
        }
        // if private & not super, hide it
        if (data.metadata.passwordProtected && !isSuper) {
          return null;
        }
        const item = {
          slug: k.name,
          url: data.url,
          passwordProtected: data.metadata.passwordProtected,
          metadata: {
            createdAt: data.metadata.formattedCreated,
            formattedExpiration: data.metadata.formattedExpiration,
            expiresAtUtc: data.metadata.expiresAtUtc,
            expirationInSeconds: Math.floor((data.metadata.expiresAtUtc - now) / 1000)
          }
        };
        // super sees the password too
        if (isSuper && data.password) {
          item.password = data.password;
        }
        return item;
      }));

      return new Response(JSON.stringify(items.filter(i => i)), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...cors }
      });
    }

    // --- 7) DELETE /api/delete ---
    if (path === '/api/delete' && method === 'DELETE') {
      const SUPER_SECRET_KEY = await KV.get('SUPER_SECRET_KEY') || '';
      const isSuper = request.headers.get('X-Super-Secret') === SUPER_SECRET_KEY;
      if (!isSuper) {
        return new Response(
          JSON.stringify({ success: false, error: 'Unauthorized' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...cors } }
        );
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid JSON' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...cors } }
        );
      }
      const { slug } = body;
      if (!slug) {
        return new Response(
          JSON.stringify({ success: false, error: 'Missing slug' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...cors } }
        );
      }
      await KV.delete(slug);
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    // --- 8) REDIRECT /:slug ---
    if (method === 'GET') {
      const slug = path.slice(1);
      if (slug) {
        const raw = await KV.get(slug);
        if (!raw) return new Response('Not Found', { status: 404, headers: cors });

        const data = JSON.parse(raw);
        const now = Date.now();

        if (now >= data.metadata.expiresAtUtc) {
          await KV.delete(slug);
          return new Response('Gone', { status: 410, headers: cors });
        }

        // if protected, check password
        if (data.metadata.passwordProtected) {
          const provided = request.headers.get('X-Link-Password') || '';
          if (provided !== data.password) {
            return new Response('Unauthorized', { status: 401, headers: cors });
          }
        }

        // public or (correctly unlocked) → redirect
        return Response.redirect(data.url, 302);
      }
    }

    // --- 9) fallback ---
    return new Response('Not Found', { status: 404, headers: cors });
  }
};

// helper functions
function getCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Super-Secret, X-Link-Password',
    'Access-Control-Max-Age': '86400'
  };
}

function generateSlug() {
  return [...Array(6)].map(() => Math.random().toString(36)[2]).join('');
}
