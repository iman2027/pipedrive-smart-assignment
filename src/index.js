import {
	oauthStart,
	oauthCallback
} from "./oauth.js";

import {
	getPipedriveUsers
} from "./pipedrive.js";

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		try {
			if (url.pathname === "/oauth/start") {
				return oauthStart(env);
			}

			if (url.pathname === "/oauth/callback") {
				return oauthCallback(request, env);
			}

			if (url.pathname === "/api/users") {
				const result = await getPipedriveUsers(env);

				if (!result.ok) {
					return Response.json(result, { status: result.status });
				}

				return Response.json(result.data);
			}

			return new Response("Pipedrive Smart Assignment App Running");
		} catch (error) {
			return Response.json(
				{
					success: false,
					error: error.message
				},
				{ status: 500 }
			);
		}
	}
};