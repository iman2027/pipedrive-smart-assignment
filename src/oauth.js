export function oauthStart(env) {
	const state = crypto.randomUUID();

	const params = new URLSearchParams({
		client_id: env.PIPEDRIVE_CLIENT_ID,
		redirect_uri: 'https://app.loc.ir/oauth/callback',
		state,
	});

	return Response.redirect('https://oauth.pipedrive.com/oauth/authorize?' + params.toString(), 302);
}

export async function oauthCallback(request, env) {
	const url = new URL(request.url);

	const code = url.searchParams.get('code');

	if (!code) {
		return Response.json(
			{
				error: 'missing_code',
			},
			{
				status: 400,
			},
		);
	}

	// IMPORTANT:
	// Pipedrive requires application/x-www-form-urlencoded

	const body = new URLSearchParams({
		client_id: env.PIPEDRIVE_CLIENT_ID,

		client_secret: env.PIPEDRIVE_CLIENT_SECRET,

		redirect_uri: 'https://app.loc.ir/oauth/callback',

		code,

		grant_type: 'authorization_code',
	});

	const tokenResponse = await fetch('https://oauth.pipedrive.com/oauth/token', {
		method: 'POST',

		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},

		body,
	});

	const tokenData = await tokenResponse.json();

	if (!tokenResponse.ok) {
		return Response.json(tokenData, {
			status: 400,
		});
	}

	/*
		Get current user
	*/

	const meResponse = await fetch('https://api.pipedrive.com/v1/users/me', {
		headers: {
			Authorization: `Bearer ${tokenData.access_token}`,
		},
	});

	const meData = await meResponse.json();

	if (!meResponse.ok) {
		return Response.json(meData, {
			status: 400,
		});
	}

	console.log(JSON.stringify(meData));

	/*
		Save token
	*/

	await env.DB.prepare(
		`
INSERT INTO oauth_tokens
(
access_token,
refresh_token,
expires_at,
user_id,
user_name
)

VALUES
(?,?,?,?,?)
`,
	)
		.bind(
			tokenData.access_token,

			tokenData.refresh_token,

			Date.now() + tokenData.expires_in * 1000,

			meData.data.id,

			meData.data.name,
		)
		.run();

	return Response.json({
		success: true,

		user: {
			id: meData.data.id,

			name: meData.data.name,
		},
	});
}
