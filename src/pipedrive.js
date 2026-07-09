import {
  Configuration as V1Configuration,
  UsersApi
} from 'pipedrive/v1';

import {
  Configuration as V2Configuration,
  DealsApi
} from 'pipedrive/v2';

async function getInstalledAccount(env, companyId = null) {
  if (companyId) {
    const row = await env.DB.prepare(`
      SELECT * FROM oauth_tokens
      WHERE company_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).bind(Number(companyId)).first();
    if (!row) throw new Error('No OAuth token found for this Pipedrive company.');
    return row;
  }

  const row = await env.DB.prepare(`
    SELECT * FROM oauth_tokens
    ORDER BY id DESC
    LIMIT 1
  `).first();
  if (!row) throw new Error('No Pipedrive OAuth token found. Open /oauth/start first.');
  return row;
}

async function refreshAccessToken(env, account) {
  const basicAuth = btoa(`${env.PIPEDRIVE_CLIENT_ID}:${env.PIPEDRIVE_CLIENT_SECRET}`);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: account.refresh_token
  });

  const response = await fetch('https://oauth.pipedrive.com/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error('Failed to refresh Pipedrive token: ' + JSON.stringify(data));
  }

  const apiDomain = data.api_domain || account.api_domain || 'https://api.pipedrive.com';
  const expiresAt = Date.now() + data.expires_in * 1000;

  await env.DB.prepare(`
    UPDATE oauth_tokens
    SET access_token = ?, refresh_token = ?, api_domain = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    data.access_token,
    data.refresh_token || account.refresh_token,
    apiDomain,
    expiresAt,
    account.id
  ).run();

  return {
    ...account,
    access_token: data.access_token,
    refresh_token: data.refresh_token || account.refresh_token,
    api_domain: apiDomain,
    expires_at: expiresAt
  };
}

async function getValidAccount(env, companyId = null) {
  let account = await getInstalledAccount(env, companyId);
  if (account.expires_at <= Date.now() + 60 * 1000) {
    account = await refreshAccessToken(env, account);
  }
  return account;
}

function getBaseHost(account) {
  return account.api_domain || 'https://api.pipedrive.com';
}

function createV1Config(account) {
  return new V1Configuration({
    accessToken: async () => account.access_token,
    basePath: `${getBaseHost(account)}/v1`
  });
}

function createV2Config(account) {
  return new V2Configuration({
    accessToken: async () => account.access_token,
    basePath: `${getBaseHost(account)}/api/v2`
  });
}

export async function getPipedriveUsers(env, companyId = null) {
  const account = await getValidAccount(env, companyId);
  const usersApi = new UsersApi(createV1Config(account));
  return usersApi.getUsers();
}

export async function getPipedriveCurrentUser(env, companyId = null) {
  const account = await getValidAccount(env, companyId);
  const usersApi = new UsersApi(createV1Config(account));
  return usersApi.getCurrentUser();
}

export async function getPipedriveDealsForOwner(env, ownerId, cursor = null, companyId = null) {
  const account = await getValidAccount(env, companyId);
  const dealsApi = new DealsApi(createV2Config(account));

  const params = {
    ownerId: Number(ownerId),
    limit: 100,
    sortBy: 'add_time',
    sortDirection: 'desc'
  };
  if (cursor) params.cursor = cursor;
  return dealsApi.getDeals(params);
}

export async function getPipedriveDealById(env, dealId, companyId = null) {
  const account = await getValidAccount(env, companyId);
  const dealsApi = new DealsApi(createV2Config(account));
  return dealsApi.getDeal({ id: Number(dealId) });
}

export async function updatePipedriveDealOwner(env, dealId, ownerId, companyId = null) {
  const account = await getValidAccount(env, companyId);
  const dealsApi = new DealsApi(createV2Config(account));
  return dealsApi.updateDeal({
    id: Number(dealId),
    UpdateDealRequest: { owner_id: Number(ownerId) }
  });
}




export async function getPipedriveDealFields(env, companyId = null) {
	const account = await getValidAccount(env, companyId);

	const response = await fetch(`${account.api_domain}/api/v1/dealFields`, {
		method: "GET",
		headers: {
			"Accept": "application/json",
			"Authorization": `Bearer ${account.access_token}`
		}
	});

	const data = await response.json();

	if (!response.ok || data.success === false) {
		throw new Error(data.error || "Could not fetch deal fields.");
	}

	return data;
}

export async function createPipedriveDealField(env, companyId, name, fieldType) {
	const account = await getValidAccount(env, companyId);

	const response = await fetch(`${account.api_domain}/api/v1/dealFields`, {
		method: "POST",
		headers: {
			"Accept": "application/json",
			"Content-Type": "application/json",
			"Authorization": `Bearer ${account.access_token}`
		},
		body: JSON.stringify({
			name,
			field_type: fieldType
		})
	});

	const data = await response.json();

	if (!response.ok || data.success === false) {
		throw new Error(data.error || "Could not create deal field.");
	}

	return data;
}

export async function getPipedriveWebhooks(env, companyId = null) {
	const account = await getValidAccount(env, companyId);

	const response = await fetch(`${account.api_domain}/api/v1/webhooks`, {
		method: "GET",
		headers: {
			"Accept": "application/json",
			"Authorization": `Bearer ${account.access_token}`
		}
	});

	const data = await response.json();

	if (!response.ok || data.success === false) {
		throw new Error(data.error || "Could not fetch webhooks.");
	}

	return data;
}

export async function createPipedriveWebhook(env, companyId, payload) {
	const account = await getValidAccount(env, companyId);

	const response = await fetch(`${account.api_domain}/api/v1/webhooks`, {
		method: "POST",
		headers: {
			"Accept": "application/json",
			"Content-Type": "application/json",
			"Authorization": `Bearer ${account.access_token}`
		},
		body: JSON.stringify(payload)
	});

	const data = await response.json();

	if (!response.ok || data.success === false) {
		throw new Error(data.error || "Could not create webhook.");
	}

	return data;
}

export async function updatePipedriveDealCustomField(env, dealId, fieldKey, value, companyId = null) {
	const account = await getValidAccount(env, companyId);

	const response = await fetch(`${account.api_domain}/api/v1/deals/${Number(dealId)}`, {
		method: "PUT",
		headers: {
			"Accept": "application/json",
			"Content-Type": "application/json",
			"Authorization": `Bearer ${account.access_token}`
		},
		body: JSON.stringify({
			[fieldKey]: value
		})
	});

	const data = await response.json();

	if (!response.ok || data.success === false) {
		throw new Error(data.error || "Could not update deal custom field.");
	}

	return data;
}