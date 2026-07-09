export function oauthStart(env) {
	const state = crypto.randomUUID();

	const params = new URLSearchParams({
		client_id: env.PIPEDRIVE_CLIENT_ID,
		redirect_uri: "https://app.loc.ir/oauth/callback",
		state
	});

	return Response.redirect(
		"https://oauth.pipedrive.com/oauth/authorize?" + params.toString(),
		302
	);
}

function getCompanyDataFromMe(meData) {
	const data = meData && meData.data ? meData.data : {};

	return {
		userId: data.id || null,
		userName: data.name || null,

		companyId:
			data.company_id ||
			(data.company && data.company.id) ||
			null,

		companyName:
			data.company_name ||
			(data.company && data.company.name) ||
			null,

		companyDomain:
			data.company_domain ||
			(data.company && data.company.domain) ||
			null
	};
}

export async function oauthCallback(request, env) {
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const error = url.searchParams.get("error");

	if (error) {
		return Response.json(
			{
				success: false,
				error,
				error_description: url.searchParams.get("error_description")
			},
			{ status: 400 }
		);
	}

	if (!code) {
		return Response.json(
			{
				success: false,
				error: "missing_code"
			},
			{ status: 400 }
		);
	}

	const basicAuth = btoa(`${env.PIPEDRIVE_CLIENT_ID}:${env.PIPEDRIVE_CLIENT_SECRET}`);

	const tokenBody = new URLSearchParams({
		grant_type: "authorization_code",
		code,
		redirect_uri: "https://app.loc.ir/oauth/callback"
	});

	const tokenResponse = await fetch("https://oauth.pipedrive.com/oauth/token", {
		method: "POST",
		headers: {
			"Authorization": `Basic ${basicAuth}`,
			"Content-Type": "application/x-www-form-urlencoded"
		},
		body: tokenBody
	});

	const tokenData = await tokenResponse.json();

	if (!tokenResponse.ok || !tokenData.access_token) {
		return Response.json(
			{
				success: false,
				step: "token_exchange",
				status: tokenResponse.status,
				pipedrive_response: tokenData
			},
			{ status: 400 }
		);
	}

	const apiDomain = tokenData.api_domain || "https://api.pipedrive.com";

	const meResponse = await fetch(`${apiDomain}/api/v1/users/me`, {
		headers: {
			"Authorization": `Bearer ${tokenData.access_token}`
		}
	});

	const meData = await meResponse.json();

	if (!meResponse.ok || !meData.success) {
		return Response.json(
			{
				success: false,
				step: "users_me",
				status: meResponse.status,
				pipedrive_response: meData
			},
			{ status: 400 }
		);
	}

	const company = getCompanyDataFromMe(meData);

	if (!company.companyId) {
		return Response.json(
			{
				success: false,
				step: "parse_company",
				message: "Could not find company_id in /users/me response.",
				users_me_response: meData
			},
			{ status: 400 }
		);
	}

	await env.DB.prepare(`
		DELETE FROM oauth_tokens
		WHERE company_id = ?
	`)
		.bind(company.companyId)
		.run();

	await env.DB.prepare(`
		INSERT INTO oauth_tokens (
			company_id,
			company_name,
			company_domain,
			api_domain,
			user_id,
			user_name,
			access_token,
			refresh_token,
			expires_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
		.bind(
			company.companyId,
			company.companyName,
			company.companyDomain,
			apiDomain,
			company.userId,
			company.userName,
			tokenData.access_token,
			tokenData.refresh_token,
			Date.now() + tokenData.expires_in * 1000
		)
		.run();

	return Response.json({
		success: true,
		company,
		api_domain: apiDomain
	});
}