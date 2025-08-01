import html from './index.html';
import docsHtml from './docs.html';
import apiDocs from './api-docs.txt';
import styleCss from './style.css';
import { DateTime } from 'luxon';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const KV = env.LinkKV;
    const API_SECRET = env.API_KEY;
    const cors = getCORSHeaders();

    // fetch super-secret-key from KV
    const SUPER_SECRET_KEY = await KV.get('SUPER_SECRET_KEY');

    // OPTIONS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Static assets
    if (path === '/' || path === '') {
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html', ...cors } });
    }
    if (path === '/docs' || path === '/docs/') {
      return new Response(docsHtml, { status: 200, headers: { 'Content-Type': 'text/html', ...cors } });
    }
    if (path === '/style.css') {
      return new Response(styleCss, { status: 200, headers: { 'Content-Type': 'text/css', ...cors } });
    }

    // API routes
    if (path.startsWith('/api/')) {
      // verify API key for all /api/* except /api/auth
      if (path !== '/api/auth') {
        const auth = request.headers.get('Authorization');
        if (!auth || auth !== `Bearer ${API_SECRET}`) {
          return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...cors }
          });
        }
      }

      // GET /api/auth
      if (path === '/api/auth') {
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
      }

      // POST /api/create
      if (path === '/api/create' && method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...cors }
          });
        }
        const { url: targetUrl, expiration, slug, password } = body;
        if (!targetUrl) {
          return new Response(JSON.stringify({ success: false, error: 'Missing URL' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...cors }
          });
        }
        const userTZ = (request.cf && request.cf.timezone) || 'America/Chicago';
        const dtExpires = expiration
          ? DateTime.fromFormat(expiration, 'yyyy-MM-dd hh:mm a', { zone: userTZ })
          : DateTime.fromMillis(Date.now()).plus({ days: 365 });
        if (!dtExpires.isValid) {
          return new Response(JSON.stringify({ success: false, error: 'Bad expiration format' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...cors }
          });
        }
        const expiresAtUtc = dtExpires.toUTC().toMillis();
        const now = Date.now();
        const dtCreated = DateTime.fromMillis(now).setZone(userTZ);
        const formattedCreated = dtCreated.toLocaleString(DateTime.DATETIME_FULL);
        const formattedExpiration = dtExpires.toLocaleString(DateTime.DATETIME_FULL);
        const key = slug || generateSlug();

        // build data including optional password
        const data = {
          url: targetUrl,
          metadata: {
            expiresAtUtc,
            formattedCreated,
            formattedExpiration,
            passwordProtected: !!password
          }
        };
        if (password) {
          data.password = password;
        }

        await KV.put(key, JSON.stringify(data));
        return new Response(JSON.stringify({
          success: true,
          slug: key,
          expirationInSeconds: Math.floor((expiresAtUtc - now) / 1000),
          passwordProtected: !!password
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...cors }
        });
      }

      // GET /api/links
      if (path === '/api/links' && method === 'GET') {
        const list = await KV.list();
        const now = Date.now();
        const isSuper = request.headers.get('X-Super-Secret') === SUPER_SECRET_KEY;

        const items = await Promise.all(list.keys.map(async k => {
          const raw = await KV.get(k.name);
          if (!raw) return null;
          const data = JSON.parse(raw);
          if (data.metadata.expiresAtUtc <= now) {
            await KV.delete(k.name);
            return null;
          }
          // filter private if not super
          if (!isSuper && data.metadata.passwordProtected) {
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

      // DELETE /api/delete
      if (path === '/api/delete' && method === 'DELETE') {
        const isSuper = request.headers.get('X-Super-Secret') === SUPER_SECRET_KEY;
        if (!isSuper) {
          return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...cors }
          });
        }
        let body;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...cors }
          });
        }
        const { slug } = body;
        if (!slug) {
          return new Response(JSON.stringify({ success: false, error: 'Missing slug' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...cors }
          });
        }
        await KV.delete(slug);
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...cors }
        });
      }
    }

    // REDIRECT /:slug
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

        // If password-protected, verify X-Link-Password
        if (data.metadata.passwordProtected) {
          const provided = request.headers.get('X-Link-Password') || '';
          if (provided !== data.password) {
            return new Response('Unauthorized', { status: 401, headers: cors });
          }
        }

        return Response.redirect(data.url, 302);
      }
    }

    return new Response('Not Found', { status: 404, headers: cors });
  }
};

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
