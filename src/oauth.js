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
		return Response.json(
			{
				success: false,
				message: 'Missing OAuth code',
			},
			{
				status: 400,
			},
		);
	}

	// Exchange authorization code for tokens

	const tokenResponse = await fetch('https://oauth.pipedrive.com/oauth/token', {
		method: 'POST',

		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},

		body: new URLSearchParams({
			grant_type: 'authorization_code',

			client_id: env.PIPEDRIVE_CLIENT_ID,

			client_secret: env.PIPEDRIVE_CLIENT_SECRET,

			redirect_uri: 'https://app.loc.ir/oauth/callback',

			code: code,
		}),
	});

	const tokenData = await tokenResponse.json();

	if (!tokenData.access_token) {
		return Response.json(
			{
				success: false,
				step: 'token_exchange',
				response: tokenData,
			},
			{
				status: 400,
			},
		);
	}

	// Get current user + company info

	const meResponse = await fetch(
		'https://api.pipedrive.com/v1/users/me',

		{
			headers: {
				Authorization: `Bearer ${tokenData.access_token}`,
			},
		},
	);

	const meData = await meResponse.json();

	if (!meData.success) {
		return Response.json(
			{
				success: false,
				step: 'get_user',
				response: meData,
			},
			{
				status: 400,
			},
		);
	}

	const user = meData.data;

	// Save token

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

	VALUES (?,?,?,?,?)

	`,
	)

		.bind(
			user.company.id,

			user.company.name,

			tokenData.access_token,

			tokenData.refresh_token,

			Date.now() + tokenData.expires_in * 1000,
		)

		.run();

	return Response.json({
		success: true,

		company: user.company.name,

		user: user.name,
	});
}
