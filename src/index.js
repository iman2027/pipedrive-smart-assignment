import { oauthStart, oauthCallback } from './oauth.js';

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname === '/oauth/start') {
			return oauthStart(env);
		}

		if (url.pathname === '/oauth/callback') {
			return oauthCallback(request, env);
		}

		return new Response('Pipedrive App Running');
	},
};
