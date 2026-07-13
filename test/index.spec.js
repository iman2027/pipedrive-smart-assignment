import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";

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
});
