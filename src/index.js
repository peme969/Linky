import html from './index.html';
import docsHtml from './docs.html';
import apiDocs from './api-docs.txt';
import styleCss from './style.txt';
import { DateTime } from 'luxon';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const KV = env.LinkKV;
    const API_SECRET = env.API_KEY;
    const cors = getCORSHeaders();

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
      // List links
      if (path === '/api/links' && method === 'GET') {
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
          return { slug: k.name, url: data.url, metadata: {
            createdAt: data.metadata.formattedCreated,
            expirationInSeconds: Math.floor((data.metadata.expiresAtUtc - now) / 1000),
            formattedExpiration: data.metadata.formattedExpiration
          }};
        }));
        return new Response(JSON.stringify(items.filter(i => i)), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
      }
      // API docs
      if (path === '/api/docs' || path === '/api/docs/') {
        return new Response(apiDocs, { status: 200, headers: { 'Content-Type': 'text/markdown', ...cors } });
      }
      // Auth
      if (path === '/api/auth') {
        const auth = request.headers.get('Authorization');
        if (!auth || auth !== `Bearer ${API_SECRET}`) {
          return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...cors } });
        }
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
      }
      // Create
      if (path === '/api/create' && method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
        }
        const { url: targetUrl, expiration, slug } = body;
        if (!targetUrl) {
          return new Response(JSON.stringify({ success: false, error: 'Missing URL' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
        }
        const userTZ = (request.cf && request.cf.timezone) || 'America/Chicago';
        const dtExpires = expiration
          ? DateTime.fromFormat(expiration, 'yyyy-MM-dd hh:mm a', { zone: userTZ })
          : DateTime.fromMillis(Date.now()).plus({ days: 365 });
        if (!dtExpires.isValid) {
          return new Response(JSON.stringify({ success: false, error: 'Bad expiration format' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
        }
        const expiresAtUtc = dtExpires.toUTC().toMillis();
        const now = Date.now();
        const dtCreated = DateTime.fromMillis(now).setZone(userTZ);
        const formattedCreated = dtCreated.toLocaleString(DateTime.DATETIME_FULL);
        const formattedExpiration = dtExpires.toLocaleString(DateTime.DATETIME_FULL);
        const key = slug || generateSlug();
        await KV.put(key, JSON.stringify({ url: targetUrl, metadata: { expiresAtUtc, formattedCreated, formattedExpiration }}));
        return new Response(JSON.stringify({ success: true, slug: key,
          expirationInSeconds: Math.floor((expiresAtUtc - now)/1000), formattedExpiration }),
          { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
      }
      // Delete
      if (path === '/api/delete' && method === 'DELETE') {
        const { slug } = await request.json();
        if (!slug) return new Response(JSON.stringify({ success: false, error: 'Missing slug' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors }});
        await KV.delete(slug);
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
      }
    }
    // Redirect
    if (method === 'GET') {
      const slug = path.slice(1);
      if (slug) {
        const raw = await KV.get(slug);
        if (!raw) return new Response('Not Found', { status: 404, headers: cors });
        const data = JSON.parse(raw);
        if (Date.now() >= data.metadata.expiresAtUtc) {
          await KV.delete(slug);
          return new Response('Gone', { status: 410, headers: cors });
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
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function generateSlug() {
  return [...Array(6)].map(() => Math.random().toString(36)[2]).join('');
}