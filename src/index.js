import html from './index.html';
import docsHtml from './docs.html';
import apiDocs from './api-docs.md';
import styleCss from './style.css';
import { DateTime } from 'luxon';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname: path } = url;
    const method = request.method;
    const KV = env.LinkKV;
    const API_SECRET = env.API_KEY;
    const cors = getCORSHeaders();

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Static
    if (path === '/' || path === '') return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html', ...cors }});
    if (path === '/docs') return new Response(docsHtml, { status: 200, headers: { 'Content-Type': 'text/html', ...cors }});
    if (path === '/style.css') return new Response(styleCss, { status: 200, headers: { 'Content-Type': 'text/css', ...cors }});

    // Auth helper
    const checkAuth = (req) => req.headers.get('Authorization') === `Bearer ${API_SECRET}`;

    // List links (private & public)
    if (path === '/api/links' && method === 'GET') {
      if (!checkAuth(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...cors }});
      const list = await KV.list();
      const now = Date.now();
      const items = await Promise.all(list.keys.map(async k => {
        const raw = await KV.get(k.name);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (data.metadata.expiresAtUtc <= now) {
          await KV.delete(k.name);
          return null;
        }
        return {
          slug: k.name,
          url: data.url,
          passwordProtected: !!data.metadata.password,
          metadata: {
            ...data.metadata,
            expirationInSeconds: Math.floor((data.metadata.expiresAtUtc - now)/1000)
          }
        };
      }));
      return new Response(JSON.stringify(items.filter(i=>i)), { status: 200, headers: { 'Content-Type': 'application/json', ...cors }});
    }

    // API docs
    if (path === '/api/docs') {
      return new Response(apiDocs, { status: 200, headers: { 'Content-Type': 'text/markdown', ...cors }});
    }

    // Auth check
    if (path === '/api/auth') {
      return checkAuth(request)
        ? new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json', ...cors }})
        : new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...cors }});
    }

    // Create link
    if (path === '/api/create' && method === 'POST') {
      if (!checkAuth(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...cors }});
      let body;
      try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status:400, headers: { 'Content-Type': 'application/json', ...cors }}); }
      const { url: targetUrl, expiration, slug, password } = body;
      if (!targetUrl) return new Response(JSON.stringify({ error: 'Missing URL' }), { status:400, headers: { 'Content-Type': 'application/json', ...cors }});

      const userTZ = (request.cf && request.cf.timezone) || 'America/Chicago';
      const dtExpires = expiration
        ? DateTime.fromFormat(expiration, 'yyyy-MM-dd hh:mm a', { zone: userTZ })
        : DateTime.now().plus({ days: 365 });
      if (!dtExpires.isValid) return new Response(JSON.stringify({ error: 'Bad expiration format' }), { status:400, headers: { 'Content-Type': 'application/json', ...cors }});

      const now = Date.now();
      const expiresAtUtc = dtExpires.toUTC().toMillis();
      const dtCreated = DateTime.fromMillis(now).setZone(userTZ);

      const payload = {
        url: targetUrl,
        metadata: {
          createdAt: dtCreated.toLocaleString(DateTime.DATETIME_FULL),
          formattedExpiration: dtExpires.toLocaleString(DateTime.DATETIME_FULL),
          expiresAtUtc,
          password: password || null
        }
      };
      const key = slug || generateSlug();
      await KV.put(key, JSON.stringify(payload));
      return new Response(JSON.stringify({ success: true, slug: key, expirationInSeconds: Math.floor((expiresAtUtc-now)/1000), passwordProtected: !!password }), { status:200, headers: { 'Content-Type': 'application/json', ...cors }});
    }

    // Delete link
    if (path === '/api/delete' && method === 'DELETE') {
      if (!checkAuth(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...cors }});
      const { slug } = await request.json();
      if (!slug) return new Response(JSON.stringify({ error: 'Missing slug' }), { status:400, headers:{ 'Content-Type':'application/json', ...cors }});
      await KV.delete(slug);
      return new Response(JSON.stringify({ success: true }), { status:200, headers:{ 'Content-Type':'application/json', ...cors }});
    }

    // Redirect
    if (method === 'GET') {
      const slug = path.slice(1);
      if (slug) {
        const raw = await KV.get(slug);
        if (!raw) return new Response('Not Found', { status:404, headers: cors });
        const data = JSON.parse(raw);
        const now = Date.now();
        if (now >= data.metadata.expiresAtUtc) {
          await KV.delete(slug);
          return new Response('Gone', { status:410, headers: cors });
        }
        if (data.metadata.password) {
          const provided = request.headers.get('X-Link-Password');
          if (provided !== data.metadata.password) {
            return new Response('Unauthorized', { status:401, headers: cors });
          }
        }
        return Response.redirect(data.url, 302);
      }
    }

    return new Response('Not Found', { status:404, headers: cors });
  }
};

function getCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Link-Password',
    'Access-Control-Max-Age': '86400'
  };
}

function generateSlug() {
  return [...Array(6)].map(() => Math.random().toString(36)[2]).join('');
}