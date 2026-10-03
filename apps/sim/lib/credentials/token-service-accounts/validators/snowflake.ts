import { tenantPrincipal, userPrincipal } from '@/lib/credentials/principal'
import {
  fetchProvider,
  parseProviderJson,
  readProviderErrorSnippet,
  TokenServiceAccountValidationError,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'
import { buildSnowflakeAuthHeaders, normalizeSnowflakeHost } from '@/tools/snowflake/utils'

/**
 * Context functions only — they resolve from the session the token opens and
 * need no warehouse, so a token whose user has no default warehouse still
 * verifies. Column order is the tuple order Snowflake returns in `data`.
 */
const IDENTITY_STATEMENT = 'SELECT CURRENT_USER(), CURRENT_ACCOUNT(), CURRENT_ROLE()'

/**
 * Seconds Snowflake may spend on the verification statement. Kept below
 * `fetchProvider`'s 10s HTTP abort so Snowflake's own timeout always wins and
 * the user sees a statement error rather than "network error reaching provider".
 */
const IDENTITY_STATEMENT_TIMEOUT_SECONDS = 5

interface SnowflakeStatementApiResponse {
  message?: string
  data?: Array<Array<string | null>>
}

/** Trimmed cell value, or undefined when Snowflake returned null/blank. */
function cell(row: Array<string | null> | undefined, index: number): string | undefined {
  const value = row?.[index]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Validates a Snowflake programmatic access token by running a context-only
 * statement against the account's SQL API — the same endpoint, headers, and
 * host normalization every Sim Snowflake tool uses, so a passing validation
 * proves the credential works with the tools as written.
 *
 * `normalizeSnowflakeHost` is the SSRF guard: it rejects anything that is not
 * a bare `*.snowflakecomputing.com`/`.cn` hostname before any outbound fetch.
 *
 * Snowflake wildcard-resolves `*.snowflakecomputing.com`, so an account that
 * does not exist still resolves and answers **404** rather than failing DNS —
 * that 404 is what identifies a mistyped host, and without the branch below it
 * would be blamed on the provider forever. The DNS mapping is kept only as a
 * defensive fallback for hosts outside the wildcard.
 */
export async function validateSnowflakeServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  let baseUrl: string
  try {
    baseUrl = normalizeSnowflakeHost(fields.domain ?? '')
  } catch {
    throw new TokenServiceAccountValidationError('site_not_found', 400, {
      step: 'host_validation',
      domain: fields.domain,
      reason: 'host is not a Snowflake account hostname',
    })
  }
  const domain = new URL(baseUrl).hostname

  const res = await fetchProvider(
    `${baseUrl}/api/v2/statements`,
    {
      method: 'POST',
      headers: buildSnowflakeAuthHeaders(fields.apiToken),
      body: JSON.stringify({
        statement: IDENTITY_STATEMENT,
        timeout: IDENTITY_STATEMENT_TIMEOUT_SECONDS,
      }),
    },
    'identity_statement',
    { dnsFailureCode: 'site_not_found', dnsFailureReason: 'account host does not resolve' }
  )

  // A wrong account host resolves through Snowflake's wildcard DNS and answers
  // 404, so it must be reported as a bad host rather than a provider outage.
  if (res.status === 404) {
    throw new TokenServiceAccountValidationError('site_not_found', 404, {
      step: 'identity_statement',
      domain,
      body: await readProviderErrorSnippet(res),
    })
  }
  // 403 is left to the shared 401/403 branch on purpose. Snowflake returns it
  // both when the SQL API is disabled and when a network policy rejects the
  // caller's IP, and the response wording for neither is documented — so rather
  // than guess from the body, both surface the provider's `invalidCredentialsHelp`,
  // which names every cause.
  await throwForProviderResponse(res, 'identity_statement', { domain })

  // 202 means the statement is still executing. A context-only SELECT that
  // Snowflake could not finish synchronously says nothing about the token, so
  // it is an outage rather than a rejection.
  if (res.status === 202) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 202, {
      step: 'identity_statement',
      domain,
      reason: 'verification statement did not complete synchronously',
    })
  }

  const payload = await parseProviderJson<SnowflakeStatementApiResponse>(res, 'identity_statement')
  const row = payload.data?.[0]
  const user = cell(row, 0)
  const account = cell(row, 1)
  const role = cell(row, 2)

  if (!account) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'identity_statement',
      domain,
      reason: 'statement succeeded without an account identity',
    })
  }

  const metadata = { account, ...(role ? { role } : {}) }
  return {
    displayName: user ? `${user} (${account})` : account,
    // A PAT belongs to one Snowflake user, so the user is the finest identity
    // available; accounts that mask it fall back to the account itself. The
    // account is carried in metadata rather than the principal's label slot,
    // which names the human actor.
    principal: user ? userPrincipal(user) : tenantPrincipal(account),
    auditMetadata: metadata,
    storedMetadata: metadata,
    normalizedDomain: domain,
  }
}
