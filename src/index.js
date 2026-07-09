import { oauthStart } from './oauth.js';

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname === '/oauth/start') {
			return oauthStart(env);
		}

		return new Response('Pipedrive App Running');
	},
};
