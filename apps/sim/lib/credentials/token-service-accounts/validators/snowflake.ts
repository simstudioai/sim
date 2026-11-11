import { EgressRefusedError } from '@/lib/core/network/transport.server'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { tenantPrincipal, userPrincipal } from '@/lib/credentials/principal'
import {
  fetchProvider,
  isHostNotFound,
  type ProviderResponse,
  parseProviderJson,
  readProviderErrorSnippet,
  TokenServiceAccountValidationError,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'
import {
  buildSnowflakeAuthHeaders,
  normalizeSnowflakeHost,
  SNOWFLAKE_WORKLOAD_IDENTITY_AUTH_STYLE,
} from '@/tools/snowflake/utils'

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
/** Matches `fetchProvider`'s abort on the PAT path. */
const IDENTITY_FETCH_TIMEOUT_MS = 10_000
const IDENTITY_MAX_RESPONSE_BYTES = 1024 * 1024

interface SnowflakeStatementApiResponse {
  message?: string
  data?: Array<Array<string | null>>
}

/** Trimmed cell value, or undefined when Snowflake returned null/blank. */
function cell(row: Array<string | null> | undefined, index: number): string | undefined {
  const value = row?.[index]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Sends the identity statement to the account; the PAT and keyless paths differ only here. */
type SendIdentityStatement = (
  url: string,
  init: { headers: Record<string, string>; body: string }
) => Promise<ProviderResponse & { json(): Promise<unknown> }>

/** The account origin, or `site_not_found` before any request when the host is not a Snowflake account host. */
function accountBaseUrl(domain: string | undefined): string {
  try {
    return normalizeSnowflakeHost(domain ?? '')
  } catch {
    throw new TokenServiceAccountValidationError('site_not_found', 400, {
      step: 'host_validation',
      domain,
      reason: 'host is not a Snowflake account hostname',
    })
  }
}

/**
 * Runs the context-only identity statement and reads who the token signed in
 * as. Shared by both credential modes so they classify Snowflake's answers the
 * same way.
 *
 * Snowflake wildcard-resolves `*.snowflakecomputing.com`, so an account that
 * does not exist still resolves and answers **404** rather than failing DNS —
 * that 404 is what identifies a mistyped host, and without the branch below it
 * would be blamed on the provider forever.
 */
async function verifySnowflakeIdentity(
  baseUrl: string,
  headers: Record<string, string>,
  send: SendIdentityStatement
): Promise<TokenServiceAccountValidationResult> {
  const domain = new URL(baseUrl).hostname

  const res = await send(`${baseUrl}/api/v2/statements`, {
    headers,
    body: JSON.stringify({
      statement: IDENTITY_STATEMENT,
      timeout: IDENTITY_STATEMENT_TIMEOUT_SECONDS,
    }),
  })

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
    // A token belongs to one Snowflake user, so the user is the finest identity
    // available; accounts that mask it fall back to the account itself. The
    // account is carried in metadata rather than the principal's label slot,
    // which names the human actor.
    principal: user ? userPrincipal(user) : tenantPrincipal(account),
    auditMetadata: metadata,
    storedMetadata: metadata,
    normalizedDomain: domain,
  }
}

/**
 * Validates a Snowflake programmatic access token by running a context-only
 * statement against the account's SQL API — the same endpoint, headers, and
 * host normalization every Sim Snowflake tool uses, so a passing validation
 * proves the credential works with the tools as written.
 *
 * `normalizeSnowflakeHost` is the SSRF guard: it rejects anything that is not
 * a bare `*.snowflakecomputing.com`/`.cn` hostname before any outbound fetch.
 * The DNS mapping is kept only as a defensive fallback for hosts outside
 * Snowflake's wildcard.
 */
export async function validateSnowflakeServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  return verifySnowflakeIdentity(
    accountBaseUrl(fields.domain),
    buildSnowflakeAuthHeaders(fields.apiToken),
    (url, init) =>
      fetchProvider(url, { method: 'POST', ...init }, 'identity_statement', {
        dnsFailureCode: 'site_not_found',
        dnsFailureReason: 'account host does not resolve',
      })
  )
}

/**
 * Verifies a keyless Snowflake connection: the token Sim signed for the
 * credential's subject is presented as workload identity federation at the
 * account host the credential pins, through the guarded egress path, so it can
 * neither be redirected nor reach a private address.
 */
export async function validateSnowflakeWorkloadIdentity(input: {
  domain: string
  subjectToken: string
}): Promise<TokenServiceAccountValidationResult> {
  return verifySnowflakeIdentity(
    accountBaseUrl(input.domain),
    buildSnowflakeAuthHeaders(input.subjectToken, SNOWFLAKE_WORKLOAD_IDENTITY_AUTH_STYLE),
    async (url, init) => {
      try {
        return await secureFetchWithValidation(url, {
          profile: 'configuredEndpoint',
          method: 'POST',
          headers: init.headers,
          body: init.body,
          timeout: IDENTITY_FETCH_TIMEOUT_MS,
          maxRedirects: 0,
          maxResponseBytes: IDENTITY_MAX_RESPONSE_BYTES,
          logUrlValidationDetails: false,
        })
      } catch (error) {
        // A host the egress policy refuses (a private address) is the user's input, not an outage.
        if (error instanceof EgressRefusedError) {
          throw new TokenServiceAccountValidationError('host_not_allowed', 400, {
            step: 'identity_statement',
            reason: 'account host not allowed',
          })
        }
        const notFound = isHostNotFound(error)
        throw new TokenServiceAccountValidationError(
          notFound ? 'site_not_found' : 'provider_unavailable',
          notFound ? 400 : 502,
          {
            step: 'identity_statement',
            reason: notFound ? 'account host does not resolve' : 'account host unreachable',
          }
        )
      }
    }
  )
}
