export function oauthStart(env) {
	const params = new URLSearchParams({
		client_id: env.PIPEDRIVE_CLIENT_ID,
		redirect_uri: 'https://app.loc.ir/oauth/callback',
		state: crypto.randomUUID(),
	});

	return Response.redirect('https://oauth.pipedrive.com/oauth/authorize?' + params.toString(), 302);
}
