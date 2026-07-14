function serializeHeaders(headers) {
  return JSON.stringify(Object.fromEntries(new Headers(headers || {}).entries()));
}

function serializeBody(body) {
  if (body === undefined || body === null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
  try { return JSON.stringify(body); }
  catch { return String(body); }
}

async function saveExternalApiCall(env, entry) {
  try {
    await env.DB.prepare(`
      INSERT INTO external_api_calls (
        company_id, service, request_started_at, response_received_at, duration_ms,
        request_method, request_url, request_headers, request_body,
        response_status, response_status_text, response_headers, response_body,
        success, error_name, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      Number(entry.companyId) || 0,
      entry.service,
      entry.requestStartedAt,
      entry.responseReceivedAt,
      entry.durationMs,
      entry.requestMethod,
      entry.requestUrl,
      entry.requestHeaders,
      entry.requestBody,
      entry.responseStatus,
      entry.responseStatusText,
      entry.responseHeaders,
      entry.responseBody,
      entry.success ? 1 : 0,
      entry.errorName,
      entry.errorMessage
    ).run();
  } catch (error) {
    console.error('Could not log external API call:', error.message);
  }
}

export async function externalApiFetch(env, service, companyId, url, init = {}, fetcher = fetch) {
  const startedAt = new Date();
  const startedMs = Date.now();
  const requestMethod = String(init.method || 'GET').toUpperCase();
  const baseEntry = {
    companyId,
    service,
    requestStartedAt: startedAt.toISOString(),
    requestMethod,
    requestUrl: String(url),
    requestHeaders: serializeHeaders(init.headers),
    requestBody: serializeBody(init.body)
  };

  try {
    const response = await fetcher(url, init);
    const responseBody = await response.clone().text();
    const responseReceivedAt = new Date();

    await saveExternalApiCall(env, {
      ...baseEntry,
      responseReceivedAt: responseReceivedAt.toISOString(),
      durationMs: Date.now() - startedMs,
      responseStatus: response.status,
      responseStatusText: response.statusText,
      responseHeaders: serializeHeaders(response.headers),
      responseBody,
      success: response.ok,
      errorName: null,
      errorMessage: null
    });

    return response;
  } catch (error) {
    const responseReceivedAt = new Date();
    await saveExternalApiCall(env, {
      ...baseEntry,
      responseReceivedAt: responseReceivedAt.toISOString(),
      durationMs: Date.now() - startedMs,
      responseStatus: null,
      responseStatusText: null,
      responseHeaders: null,
      responseBody: null,
      success: false,
      errorName: error.name || 'Error',
      errorMessage: error.message || String(error)
    });
    throw error;
  }
}
