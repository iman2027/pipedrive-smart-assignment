import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { beforeAll, describe, it, expect } from "vitest";
import worker from "../src";
import { externalApiFetch } from "../src/externalApi.js";

beforeAll(async () => {
	await env.DB.prepare(`
		CREATE TABLE IF NOT EXISTS rate_limits (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			company_id INTEGER NOT NULL,
			route_key TEXT NOT NULL,
			window_start INTEGER NOT NULL,
			request_count INTEGER NOT NULL DEFAULT 0,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			request_received_at DATETIME, request TEXT, request_method TEXT,
			request_url TEXT, request_path TEXT, request_query TEXT, request_headers TEXT,
			request_body TEXT, request_ip TEXT, request_user_agent TEXT,
			request_content_type TEXT, request_country TEXT,
			UNIQUE(company_id, route_key, window_start)
		)
	`).run();
	await env.DB.prepare(`
		CREATE TABLE IF NOT EXISTS external_api_calls (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			company_id INTEGER NOT NULL DEFAULT 0,
			service TEXT NOT NULL,
			request_started_at DATETIME NOT NULL,
			response_received_at DATETIME,
			duration_ms INTEGER,
			request_method TEXT NOT NULL,
			request_url TEXT NOT NULL,
			request_headers TEXT,
			request_body TEXT,
			response_status INTEGER,
			response_status_text TEXT,
			response_headers TEXT,
			response_body TEXT,
			success INTEGER NOT NULL DEFAULT 0,
			error_name TEXT,
			error_message TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`).run();
});

function base64Url(value) {
	const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createPipedriveToken(companyId, userId) {
	const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const payload = base64Url(JSON.stringify({ companyId, userId, exp: Math.floor(Date.now() / 1000) + 300 }));
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(env.PIPEDRIVE_JWT_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`));
	return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

describe("Pipedrive Smart Assignment worker", () => {
	it("responds with the app status (unit style)", async () => {
		const request = new Request("http://example.com");
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"Pipedrive Smart Assignment App Running"`);
	});

	it("responds with the app status (integration style)", async () => {
		const response = await SELF.fetch("http://example.com");
		expect(await response.text()).toMatchInlineSnapshot(`"Pipedrive Smart Assignment App Running"`);
	});

	it("rejects direct access to the company analysis page", async () => {
		const response = await SELF.fetch("http://example.com/company-sales-analysis");
		expect(response.status).toBe(401);
	});

	it("serves the company analysis page only for a matching organization detail context", async () => {
		const token = await createPipedriveToken(123, 456);
		const validUrl = new URL("http://example.com/company-sales-analysis");
		validUrl.search = new URLSearchParams({
			resource: "organization", view: "details", companyId: "123", userId: "456",
			selectedIds: "789", token
		}).toString();
		const validResponse = await SELF.fetch(validUrl);
		expect(validResponse.status).toBe(200);
		expect(await validResponse.text()).toContain("تحلیل هوشمند شرکت");

		validUrl.searchParams.set("resource", "deal");
		const invalidResponse = await SELF.fetch(validUrl);
		expect(invalidResponse.status).toBe(403);
	});

	it("logs every request, including OAuth routes, without applying a new limit", async () => {
		const before = await env.DB.prepare("SELECT COUNT(*) AS count FROM rate_limits WHERE route_key LIKE 'request:%'").first();
		await SELF.fetch(new Request("http://example.com/oauth/start?source=test", { redirect: "manual" }));
		await SELF.fetch("http://example.com/oauth/callback?error=access_denied&source=test");
		const after = await env.DB.prepare("SELECT COUNT(*) AS count FROM rate_limits WHERE route_key LIKE 'request:%'").first();
		expect(Number(after.count)).toBe(Number(before.count) + 2);

		const callbackLog = await env.DB.prepare(`
			SELECT request_method, request_path, request_query
			FROM rate_limits WHERE request_path = '/oauth/callback'
			ORDER BY id DESC LIMIT 1
		`).first();
		expect(callbackLog).toMatchObject({
			request_method: "GET",
			request_path: "/oauth/callback",
			request_query: "?error=access_denied&source=test"
		});
	});

	it("stores complete external API request and response data", async () => {
		const response = await externalApiFetch(
			env,
			"test-service",
			321,
			"https://api.example.com/items?full=true",
			{
				method: "POST",
				headers: { "Content-Type": "application/json", "X-Api-Key": "secret" },
				body: JSON.stringify({ name: "sample", count: 2 })
			},
			async () => new Response(JSON.stringify({ id: 9, saved: true, nested: { value: "complete" } }), {
				status: 201,
				statusText: "Created",
				headers: { "Content-Type": "application/json", "X-Request-Id": "req-123" }
			})
		);

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ id: 9, saved: true, nested: { value: "complete" } });

		const log = await env.DB.prepare(`
			SELECT * FROM external_api_calls
			WHERE service = 'test-service'
			ORDER BY id DESC LIMIT 1
		`).first();
		expect(log).toMatchObject({
			company_id: 321,
			request_method: "POST",
			request_url: "https://api.example.com/items?full=true",
			request_body: JSON.stringify({ name: "sample", count: 2 }),
			response_status: 201,
			response_status_text: "Created",
			response_body: JSON.stringify({ id: 9, saved: true, nested: { value: "complete" } }),
			success: 1
		});
		expect(JSON.parse(log.request_headers)).toMatchObject({ "content-type": "application/json", "x-api-key": "secret" });
		expect(JSON.parse(log.response_headers)).toMatchObject({ "content-type": "application/json", "x-request-id": "req-123" });
	});
});
