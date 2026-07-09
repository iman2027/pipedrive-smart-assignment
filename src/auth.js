function base64UrlToBytes(value) {
  let base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToUtf8(bytes) {
  return new TextDecoder().decode(bytes);
}

function getTokenFromRequest(request) {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;
  const headerToken = request.headers.get('X-Pipedrive-Token') || request.headers.get('x-pipedrive-token');
  if (headerToken) return headerToken;
  const authorization = request.headers.get('Authorization') || '';
  if (authorization.startsWith('Bearer ')) return authorization.slice('Bearer '.length);
  return null;
}

async function verifyHs256Jwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format.');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(bytesToUtf8(base64UrlToBytes(encodedHeader)));
  const payload = JSON.parse(bytesToUtf8(base64UrlToBytes(encodedPayload)));
  if (header.alg !== 'HS256') throw new Error('Unsupported JWT algorithm.');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlToBytes(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );

  if (!valid) throw new Error('Invalid JWT signature.');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && Number(payload.exp) < now) throw new Error('JWT expired.');
  if (payload.nbf && Number(payload.nbf) > now) throw new Error('JWT not active yet.');

  return payload;
}

function getCompanyIdFromPayload(payload) {
  return Number(payload.companyId || payload.company_id || payload.companyID || 0);
}

function getUserIdFromPayload(payload) {
  return Number(payload.userId || payload.user_id || payload.userID || 0);
}

export async function requirePipedriveAuth(request, env) {
  const token = getTokenFromRequest(request);
  if (!token) {
    throw new Response(JSON.stringify({ success: false, error: 'Missing Pipedrive JWT token.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const secret = env.PIPEDRIVE_JWT_SECRET || env.PIPEDRIVE_CLIENT_SECRET;
  if (!secret) {
    throw new Response(JSON.stringify({ success: false, error: 'PIPEDRIVE_JWT_SECRET is not configured.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const payload = await verifyHs256Jwt(token, secret);
    const companyId = getCompanyIdFromPayload(payload);
    const userId = getUserIdFromPayload(payload);
    if (!companyId || !userId) throw new Error('JWT does not include companyId/userId.');
    return { token, payload, companyId, userId };
  } catch (error) {
    throw new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function enforceRateLimit(env, companyId, routeKey, limit, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;

  const row = await env.DB.prepare(`
    SELECT request_count
    FROM rate_limits
    WHERE company_id = ? AND route_key = ? AND window_start = ?
  `).bind(companyId, routeKey, windowStart).first();

  if (!row) {
    await env.DB.prepare(`
      INSERT INTO rate_limits (company_id, route_key, window_start, request_count, updated_at)
      VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
    `).bind(companyId, routeKey, windowStart).run();
    return;
  }

  const currentCount = Number(row.request_count || 0);
  if (currentCount >= limit) {
    throw new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(windowSeconds) }
    });
  }

  await env.DB.prepare(`
    UPDATE rate_limits
    SET request_count = request_count + 1, updated_at = CURRENT_TIMESTAMP
    WHERE company_id = ? AND route_key = ? AND window_start = ?
  `).bind(companyId, routeKey, windowStart).run();
}
