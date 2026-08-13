const DEFAULT_API_HOST = 'https://api.logrocket.com'

interface AppScope {
  orgId: string
  appId: string
  apiHost?: string
}

/**
 * Every LogRocket REST endpoint hangs off `/v1/orgs/<org>/apps/<app>/`. Private
 * Cloud deployments serve the same paths from their own `domains.api` host.
 * See https://docs.logrocket.com/docs/data-export
 */
export function buildAppUrl(params: AppScope, path: string): URL {
  const host = (params.apiHost || DEFAULT_API_HOST).trim().replace(/\/+$/, '')
  const org = encodeURIComponent(params.orgId.trim())
  const app = encodeURIComponent(params.appId.trim())
  return new URL(`${host}/v1/orgs/${org}/apps/${app}/${path}`)
}

export function buildAuthHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `token ${apiKey}` }
}

/**
 * LogRocket returns plain text for some error statuses, so the JSON parse is
 * best-effort and the raw body is preserved as the fallback message.
 */
export async function throwOnError(response: Response, label: string): Promise<unknown> {
  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }

  if (!response.ok) {
    const message =
      (data as { error?: string; message?: string } | null)?.error ??
      (data as { error?: string; message?: string } | null)?.message ??
      text
    throw new Error(`${label} error (${response.status}): ${message || response.statusText}`)
  }

  return data
}
