export function oauthStart(env) {
	const params = new URLSearchParams({
		client_id: env.PIPEDRIVE_CLIENT_ID,
		redirect_uri: 'https://app.loc.ir/oauth/callback',
		state: crypto.randomUUID(),
	});

	return Response.redirect('https://oauth.pipedrive.com/oauth/authorize?' + params.toString(), 302);
}

export async function oauthCallback(request, env) {
	const url = new URL(request.url);

	const code = url.searchParams.get('code');

	if (!code) {
		return new Response('Missing OAuth code', {
			status: 400,
		});
	}

	const body = new URLSearchParams({
		client_id: env.PIPEDRIVE_CLIENT_ID,

		client_secret: env.PIPEDRIVE_CLIENT_SECRET,

		redirect_uri: 'https://app.loc.ir/oauth/callback',

		code: code,

		grant_type: 'authorization_code',
	});

	const response = await fetch('https://oauth.pipedrive.com/oauth/token', {
		method: 'POST',

		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},

		body,
	});

	const data = await response.json();

	if (!data.access_token) {
		return Response.json(data, {
			status: 400,
		});
	}

	// گرفتن اطلاعات Organization و User

	const meResponse = await fetch('https://api.pipedrive.com/v1/users/me', {
		headers: {
			Authorization: `Bearer ${data.access_token}`,
		},
	});

	const me = await meResponse.json();

	await env.DB.prepare(
		`
	INSERT INTO oauth_tokens
	(
	company_id,
	company_name,
	access_token,
	refresh_token,
	expires_at
	)

	VALUES
	(?,?,?,?,?)
	`,
	)
		.bind(
			me.data.company_id,

			me.data.company.name,

			data.access_token,

			data.refresh_token,

			Date.now() + data.expires_in * 1000,
		)
		.run();

	return Response.json({
		success: true,

		company: me.data.company.name,
	});
}
