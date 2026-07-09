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

import {
	assignDeal,
	getAssignmentSummary
} from "./assignment.js";

import {
	handleJsonLeadScoringModal,
	getCustomLeadScoringPage
} from "./leadScoring.js";

import {
	getSidebarPage
} from "./sidebar.js";

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

			if (url.pathname === "/json-lead-scoring") {
				return handleJsonLeadScoringModal(request, env);
			}

			if (url.pathname === "/custom-lead-scoring") {
				return getCustomLeadScoringPage(request);
			}

			if (url.pathname === "/sidebar") {
				return getSidebarPage();
			}

			if (url.pathname === "/api/users") {
				const result = await getPipedriveUsers(env);
				return Response.json(result);
			}

			if (url.pathname === "/api/capacities" && request.method === "GET") {
				return getCapacities(env);
			}

			if (url.pathname === "/api/capacities" && request.method === "POST") {
				return saveCapacities(request, env);
			}

			if (url.pathname === "/api/assign" && request.method === "POST") {
				return assignDeal(request, env);
			}

			if (url.pathname === "/api/assignment-summary" && request.method === "GET") {
				return getAssignmentSummary(env);
			}

			return new Response("Pipedrive Smart Assignment App Running");
		} catch (error) {
			return Response.json(
				{
					success: false,
					error: error.message,
					stack: error.stack
				},
				{ status: 500 }
			);
		}
	}
};