import { parseAtlassianErrorMessage } from '@/tools/jira/utils'

/**
 * Discrete validation failure codes returned to the client. The UI maps each
 * code to a human message; raw Atlassian response bodies stay in server logs.
 */
export type AtlassianValidationCode =
  | 'invalid_credentials'
  | 'site_not_found'
  | 'atlassian_unavailable'

export class AtlassianValidationError extends Error {
  constructor(
    public readonly code: AtlassianValidationCode,
    public readonly status: number,
    public readonly logDetail?: Record<string, unknown>
  ) {
    super(code)
    this.name = 'AtlassianValidationError'
  }
}

/**
 * Atlassian Cloud sites are always served from `*.atlassian.net` (production)
 * or `*.jira-dev.com` (Atlassian's developer sandbox). Anything else is either
 * a typo (`atlassian.com`, `jira.com`), a Data Center hostname (which our
 * gateway URL doesn't support), or — worse — an attempt to point this
 * server-side fetch at internal infrastructure (`localhost`, `169.254.169.254`,
 * `*.corp`). Restricting to the public Atlassian Cloud suffixes blocks SSRF
 * at the boundary before any outbound request.
 */
const ATLASSIAN_CLOUD_HOST_REGEX =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:atlassian\.net|jira-dev\.com)$/i

export function normalizeAtlassianDomain(rawDomain: string): string {
  return rawDomain.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
}

function assertAtlassianCloudHost(domain: string): void {
  if (!ATLASSIAN_CLOUD_HOST_REGEX.test(domain)) {
    throw new AtlassianValidationError('site_not_found', 400, {
      step: 'host_validation',
      domain,
      reason: 'host is not an Atlassian Cloud site (expected *.atlassian.net)',
    })
  }
}

/**
 * Throws an `AtlassianValidationError` with `unauthorizedCode` for 401/403 responses
 * (which mean the token itself was rejected) and `atlassian_unavailable` for any
 * other non-2xx.
 */
async function assertAtlassianResponseOk(
  res: Response,
  step: string,
  unauthorizedCode: AtlassianValidationCode,
  context: Record<string, unknown> = {}
): Promise<void> {
  if (res.ok) return
  const body = parseAtlassianErrorMessage(res.status, res.statusText, await res.text())
  if (res.status === 401 || res.status === 403) {
    throw new AtlassianValidationError(unauthorizedCode, res.status, { step, body, ...context })
  }
  throw new AtlassianValidationError('atlassian_unavailable', res.status, {
    step,
    body,
    ...context,
  })
}

/**
 * Validates an Atlassian service account scoped API token.
 *
 * Scoped service-account tokens cannot call `api.atlassian.com/oauth/token/accessible-resources`
 * (that endpoint is for OAuth-3LO tokens). Instead we use the public, unauthenticated
 * `tenant_info` discovery endpoint to resolve cloudId from the site domain, then verify
 * the token works by hitting `/myself` through the gateway.
 */
export async function validateAtlassianServiceAccount(
  apiToken: string,
  domain: string
): Promise<{ accountId: string; displayName: string; cloudId: string }> {
  assertAtlassianCloudHost(domain)

  const tenantInfoRes = await fetch(`https://${domain}/_edge/tenant_info`, {
    headers: { Accept: 'application/json' },
  })
  if (tenantInfoRes.status === 404) {
    throw new AtlassianValidationError('site_not_found', 404, { step: 'tenant_info', domain })
  }
  // tenant_info is unauthenticated, so there is no "invalid credentials" branch here —
  // any non-OK that isn't a 404 means Atlassian is unavailable, not the token's fault.
  await assertAtlassianResponseOk(tenantInfoRes, 'tenant_info', 'atlassian_unavailable', { domain })
  const tenantInfo = (await tenantInfoRes.json()) as { cloudId?: string }
  if (!tenantInfo.cloudId) {
    throw new AtlassianValidationError('atlassian_unavailable', 502, {
      step: 'tenant_info',
      reason: 'missing cloudId in response',
      domain,
    })
  }
  const cloudId = tenantInfo.cloudId

  const myselfRes = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`, {
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  })
  await assertAtlassianResponseOk(myselfRes, 'myself', 'invalid_credentials', { cloudId })

  const myself = (await myselfRes.json()) as {
    accountId?: string
    displayName?: string
    emailAddress?: string
  }
  if (!myself.accountId) {
    throw new AtlassianValidationError('atlassian_unavailable', 502, {
      step: 'myself',
      reason: 'missing accountId in response',
    })
  }

  return {
    accountId: myself.accountId,
    displayName: myself.displayName || myself.emailAddress || domain,
    cloudId,
  }
}
