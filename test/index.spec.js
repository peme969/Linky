import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
  SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";

const hash = async (str) => {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

describe("Linky worker", () => {
  it("serves index page at root", async () => {
    const response = await SELF.fetch("http://example.com/");
    const text = await response.text();
    expect(text).toContain("<!doctype html>");
  });

  it("increments click count on redirect", async () => {
    const slug = "abc123";
    const now = Date.now();
    await env.URLS.put(
      slug,
      JSON.stringify({
        url: "https://example.com",
        clicks: 0,
        metadata: {
          createdAtUtc: now,
          formattedCreated: "",
          expiresAtUtc: null,
          formattedExpiration: "Never",
          passwordProtected: false,
        },
      })
    );

    const request = new Request(`http://example.com/${slug}`);
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(302);

    const stored = await env.URLS.get(slug);
    const data = JSON.parse(stored);
    expect(data.clicks).toBe(1);
  });

  it("serves a password form and validates passwords", async () => {
    const slug = "secure";
    const now = Date.now();
    const passwordHash = await hash("secret");
    await env.URLS.put(
      slug,
      JSON.stringify({
        url: "https://example.com",
        clicks: 0,
        passwordHash,
        metadata: {
          createdAtUtc: now,
          formattedCreated: "",
          expiresAtUtc: null,
          formattedExpiration: "Never",
          passwordProtected: true,
        },
      }),
    );

    // GET should return HTML form
    let req = new Request(`http://example.com/${slug}`);
    let ctx = createExecutionContext();
    let resp = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    const body = await resp.text();
    expect(resp.status).toBe(200);
    expect(body).toContain("Enter password");

    // POST wrong password
    req = new Request(`http://example.com/${slug}`, {
      method: "POST",
      body: new URLSearchParams({ password: "wrong" }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    ctx = createExecutionContext();
    resp = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(resp.status).toBe(401);

    // POST correct password
    req = new Request(`http://example.com/${slug}`, {
      method: "POST",
      body: new URLSearchParams({ password: "secret" }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    ctx = createExecutionContext();
    resp = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(resp.status).toBe(302);

    const stored = await env.URLS.get(slug);
    const data = JSON.parse(stored);
    expect(data.clicks).toBe(1);
  });

  it("supports legacy links with plaintext passwords", async () => {
    const slug = "legacy";
    const now = Date.now();
    await env.URLS.put(
      slug,
      JSON.stringify({
        url: "https://example.com",
        clicks: 0,
        password: "secret",
        metadata: {
          createdAtUtc: now,
          formattedCreated: "",
          expiresAtUtc: null,
          formattedExpiration: "Never",
          passwordProtected: true,
        },
      }),
    );

    // GET should return HTML form
    let req = new Request(`http://example.com/${slug}`);
    let ctx = createExecutionContext();
    let resp = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(resp.status).toBe(200);

    // POST wrong password
    req = new Request(`http://example.com/${slug}`, {
      method: "POST",
      body: new URLSearchParams({ password: "wrong" }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    ctx = createExecutionContext();
    resp = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(resp.status).toBe(401);

    // POST correct password
    req = new Request(`http://example.com/${slug}`, {
      method: "POST",
      body: new URLSearchParams({ password: "secret" }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    ctx = createExecutionContext();
    resp = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(resp.status).toBe(302);

    const stored = JSON.parse(await env.URLS.get(slug));
    expect(stored.passwordHash).toBe(await hash("secret"));
  });

  it("allows super user to view private link passwords", async () => {
    const slug = "priv";
    const now = Date.now();
    const password = "secret";
    const passwordHash = await hash(password);
    await env.URLS.put(
      slug,
      JSON.stringify({
        url: "https://example.com",
        clicks: 0,
        password,
        passwordHash,
        metadata: {
          createdAtUtc: now,
          formattedCreated: "",
          expiresAtUtc: null,
          formattedExpiration: "Never",
          passwordProtected: true,
        },
      }),
    );
    await env.URLS.put("SUPER_SECRET_KEY", "topsecret");
    env.API_KEY = "key";

    const req = new Request("http://example.com/api/links", {
      headers: {
        Authorization: "Bearer key",
        "X-Super-Secret": "topsecret",
      },
    });
    const ctx = createExecutionContext();
    const resp = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    const data = await resp.json();
    expect(Array.isArray(data)).toBe(true);
    const item = data.find((i) => i.slug === slug);
    expect(item.password).toBe(password);
  });

  it("requires valid API key to create links", async () => {
    env.API_KEY = "secret";
    const body = JSON.stringify({ url: "https://example.com" });

    // No Authorization header
    let req = new Request("http://example.com/api/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    let ctx = createExecutionContext();
    let resp = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(resp.status).toBe(401);

    // Wrong key
    req = new Request("http://example.com/api/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong",
      },
      body,
    });
    ctx = createExecutionContext();
    resp = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(resp.status).toBe(401);

    // Correct key
    req = new Request("http://example.com/api/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret",
      },
      body,
    });
    ctx = createExecutionContext();
    resp = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(resp.status).toBe(200);
  });
});

