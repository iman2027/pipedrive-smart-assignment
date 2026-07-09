async function getInstalledAccount(env) {
	const row = await env.DB.prepare(`
		SELECT *
		FROM oauth_tokens
		ORDER BY id DESC
		LIMIT 1
	`).first();

	if (!row) {
		throw new Error("No Pipedrive OAuth token found. Open /oauth/start first.");
	}

	return row;
}

async function refreshAccessToken(env, account) {
	const basicAuth = btoa(`${env.PIPEDRIVE_CLIENT_ID}:${env.PIPEDRIVE_CLIENT_SECRET}`);

	const body = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: account.refresh_token
	});

	const response = await fetch("https://oauth.pipedrive.com/oauth/token", {
		method: "POST",
		headers: {
			"Authorization": `Basic ${basicAuth}`,
			"Content-Type": "application/x-www-form-urlencoded"
		},
		body
	});

	const data = await response.json();

	if (!response.ok || !data.access_token) {
		throw new Error("Failed to refresh Pipedrive token: " + JSON.stringify(data));
	}

	const apiDomain = data.api_domain || account.api_domain || "https://api.pipedrive.com";
	const expiresAt = Date.now() + data.expires_in * 1000;

	await env.DB.prepare(`
		UPDATE oauth_tokens
		SET
			access_token = ?,
			refresh_token = ?,
			api_domain = ?,
			expires_at = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`)
		.bind(
			data.access_token,
			data.refresh_token || account.refresh_token,
			apiDomain,
			expiresAt,
			account.id
		)
		.run();

	return {
		...account,
		access_token: data.access_token,
		refresh_token: data.refresh_token || account.refresh_token,
		api_domain: apiDomain,
		expires_at: expiresAt
	};
}

async function getValidAccount(env) {
	let account = await getInstalledAccount(env);

	const oneMinuteFromNow = Date.now() + 60 * 1000;

	if (account.expires_at <= oneMinuteFromNow) {
		account = await refreshAccessToken(env, account);
	}

	return account;
}

export async function pipedriveRequest(env, path, options = {}) {
	const account = await getValidAccount(env);

	const apiDomain = account.api_domain || "https://api.pipedrive.com";
	const url = new URL(path, apiDomain);

	const response = await fetch(url.toString(), {
		...options,
		headers: {
			"Authorization": `Bearer ${account.access_token}`,
			"Content-Type": "application/json",
			...(options.headers || {})
		}
	});

	const data = await response.json();

	if (!response.ok) {
		return {
			ok: false,
			status: response.status,
			data
		};
	}

	return {
		ok: true,
		status: response.status,
		data
	};
}

export async function getPipedriveUsers(env) {
	return pipedriveRequest(env, "/api/v1/users");
}