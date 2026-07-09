import {
	oauthStart,
	oauthCallback
} from "./oauth.js";

import {
	getPipedriveUsers
} from "./pipedrive.js";

import {
	getSettingsPage,
	getCapacities,
	saveCapacities
} from "./settings.js";

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

			if (url.pathname === "/settings") {
				return getSettingsPage();
			}

			if (url.pathname === "/api/users") {
				const result = await getPipedriveUsers(env);

				if (!result.ok) {
					return Response.json(result, { status: result.status });
				}

				return Response.json(result.data);
			}

			if (url.pathname === "/api/capacities" && request.method === "GET") {
				return getCapacities(env);
			}

			if (url.pathname === "/api/capacities" && request.method === "POST") {
				return saveCapacities(request, env);
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