import { oauthStart, oauthCallback } from './oauth.js';
import { getPipedriveUsers } from './pipedrive.js';
import { getSettingsPage, getCapacities, saveCapacities } from './settings.js';
import { assignDeal, getAssignmentSummary } from './assignment.js';
import { handleJsonLeadScoringModal, getCustomLeadScoringPage } from './leadScoring.js';
import { getSidebarPage } from './sidebar.js';
import { getBitcoinJsonPanel } from './bitcoinPanel.js';
import { requirePipedriveAuth, enforceRateLimit } from './auth.js';
import {
  handlePipedriveWebhook
} from "./webhooks.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/oauth/start') {
        	return oauthStart(env, request);
      }

      if (url.pathname === '/oauth/callback') {
        return oauthCallback(request, env);
      }

      if (url.pathname === '/settings') {
        await requirePipedriveAuth(request, env);
        return getSettingsPage();
      }

      if (url.pathname === '/custom-lead-scoring') {
        await requirePipedriveAuth(request, env);
        return getCustomLeadScoringPage(request);
      }

      if (url.pathname === '/sidebar') {
        await requirePipedriveAuth(request, env);
        return getSidebarPage();
      }

      if (url.pathname === '/json-lead-scoring') {
        const authContext = await requirePipedriveAuth(request, env);
        await enforceRateLimit(env, authContext.companyId, 'json-lead-scoring', 60, 60);
        return handleJsonLeadScoringModal(request, env, authContext);
      }

      if (url.pathname === '/bitcoin-panel') {
        const authContext = await requirePipedriveAuth(request, env);
        await enforceRateLimit(env, authContext.companyId, 'bitcoin-panel', 120, 60);
        return getBitcoinJsonPanel();
      }

      if (url.pathname === '/api/users') {
        const authContext = await requirePipedriveAuth(request, env);
        const result = await getPipedriveUsers(env, authContext.companyId);
        return Response.json(result);
      }

      if (url.pathname === '/api/capacities' && request.method === 'GET') {
        const authContext = await requirePipedriveAuth(request, env);
        return getCapacities(env, authContext);
      }

      if (url.pathname === '/api/capacities' && request.method === 'POST') {
        const authContext = await requirePipedriveAuth(request, env);
        await enforceRateLimit(env, authContext.companyId, 'save-capacities', 20, 60);
        return saveCapacities(request, env, authContext);
      }

      if (url.pathname === '/api/assign' && request.method === 'POST') {
        const authContext = await requirePipedriveAuth(request, env);
        await enforceRateLimit(env, authContext.companyId, 'assign', 60, 60);
        return assignDeal(request, env, authContext);
      }

      if (url.pathname === '/api/assignment-summary' && request.method === 'GET') {
        const authContext = await requirePipedriveAuth(request, env);
        await enforceRateLimit(env, authContext.companyId, 'assignment-summary', 120, 60);
        return getAssignmentSummary(env, authContext);
      }

      if (url.pathname === "/webhooks/pipedrive" && request.method === "POST") {
        return handlePipedriveWebhook(request, env);
      }

      return new Response('Pipedrive Smart Assignment App Running');
    } catch (error) {
      if (error instanceof Response) return error;
      return Response.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }
  }
};
