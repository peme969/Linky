import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
  SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";

describe("URL shortener worker", () => {
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
});

