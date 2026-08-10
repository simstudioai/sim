import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { snowflakeObjectsSelectorContract } from '@/lib/api/contracts/selectors/snowflake'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveCredentialAccessToken } from '@/lib/oauth/credential-service'
import { buildSelectorStatement } from '@/tools/snowflake/sql'
import {
  buildSnowflakeAuthHeaders,
  normalizeSnowflakeHost,
  readSnowflakeResult,
} from '@/tools/snowflake/utils'

const logger = createLogger('SnowflakeObjectsAPI')

export const dynamic = 'force-dynamic'

/** Rows a single picker may pull back. Bounded in SQL, not after the fact. */
const SELECTOR_ROW_LIMIT = 1000

/** Seconds Snowflake may spend on a picker statement before giving up. */
const SELECTOR_TIMEOUT_SECONDS = 20

/**
 * HTTP-level abort. `SELECTOR_TIMEOUT_SECONDS` only bounds Snowflake's own
 * execution; without this a stalled socket would pin the request until the
 * runtime's socket wall.
 */
const SELECTOR_FETCH_TIMEOUT_MS = (SELECTOR_TIMEOUT_SECONDS + 10) * 1000

interface SnowflakeObject {
  name: string
  detail: string | null
}

/**
 * Parses the JSON array `CURRENT_AVAILABLE_ROLES()` returns — a single row
 * holding a string like `["PUBLIC","ANALYST"]`.
 */
function parseAvailableRoles(cellValue: string | null | undefined): SnowflakeObject[] {
  if (!cellValue) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(cellValue)
  } catch {
    logger.warn('CURRENT_AVAILABLE_ROLES returned a non-JSON payload')
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((role): role is string => typeof role === 'string' && role.length > 0)
    .sort((a, b) => a.localeCompare(b))
    .map((role) => ({ name: role, detail: null }))
}

/**
 * POST /api/tools/snowflake/objects
 *
 * Enumerates Snowflake objects for the editor's pickers (databases, schemas,
 * tables, warehouses, roles, file formats, procedures) using the selected
 * programmatic-access-token credential. Every statement is
 * metadata-only, so no warehouse is required and nothing is billed for
 * compute. The token never reaches the browser — the credential id is
 * resolved server-side on each call.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  // Authenticate the caller before touching the body: contract validation must
  // never run for an unauthenticated request. This reads headers and the
  // session only, so it is safe ahead of parsing.
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: true })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Authentication required' }, { status: 401 })
  }

  const parsed = await parseRequest(
    snowflakeObjectsSelectorContract,
    request,
    {},
    {
      validationErrorResponse: (error) => {
        const path = error.issues.at(0)?.path[0]
        const message =
          path === 'credential'
            ? 'Credential is required'
            : getValidationErrorMessage(error, 'Invalid request')
        logger.error(`Validation failed for Snowflake objects request: ${message}`)
        return NextResponse.json({ error: message }, { status: 400 })
      },
    }
  )
  if (!parsed.success) return parsed.response
  const { credential, workflowId, kind, database, schema } = parsed.data.body

  const authz = await authorizeCredentialUse(request, {
    credentialId: credential,
    workflowId,
    callerUserId: auth.userId,
  })
  if (!authz.ok || !authz.credentialOwnerUserId) {
    return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
  }

  const token = await resolveCredentialAccessToken(
    credential,
    authz.credentialOwnerUserId,
    requestId
  )
  if (!token?.accessToken || !token.domain) {
    logger.error('Failed to resolve Snowflake credential', { credentialId: credential, kind })
    return NextResponse.json(
      { error: 'Could not resolve the Snowflake credential', authRequired: true },
      { status: 401 }
    )
  }

  let baseUrl: string
  let statement: string
  try {
    baseUrl = normalizeSnowflakeHost(token.domain)
    statement = buildSelectorStatement(kind, { database, schema }, SELECTOR_ROW_LIMIT).statement
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, 'Invalid request') }, { status: 400 })
  }

  let upstreamStatus = 0
  try {
    const response = await fetch(`${baseUrl}/api/v2/statements`, {
      method: 'POST',
      headers: buildSnowflakeAuthHeaders(token.accessToken),
      body: JSON.stringify({
        statement,
        timeout: SELECTOR_TIMEOUT_SECONDS,
        parameters: { rows_per_resultset: SELECTOR_ROW_LIMIT },
      }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(SELECTOR_FETCH_TIMEOUT_MS)]),
    })

    // A rejected credential must tell the picker to reconnect rather than read
    // as an outage or a bad request. 403 belongs here alongside 401: Snowflake
    // uses it for a network-policy rejection and for a disabled SQL API, which
    // is why the credential validator also treats it as a credential problem.
    if (response.status === 401 || response.status === 403) {
      logger.warn('Snowflake rejected the stored credential', { credentialId: credential, kind })
      return NextResponse.json(
        {
          error:
            'Snowflake rejected this credential. Check that it has not expired and that a network policy allows Sim to reach the account, then reconnect it.',
          authRequired: true,
        },
        { status: 401 }
      )
    }

    // A remaining 4xx names something wrong with the request itself (unknown
    // object, malformed statement); only a 5xx or an unreadable body is a
    // gateway failure.
    upstreamStatus = response.status
    const result = await readSnowflakeResult(response)
    // A metadata-only statement completes synchronously; a 202 means Snowflake
    // deferred it, and returning an empty list would read as "no objects".
    if (!result.result) {
      logger.warn('Snowflake deferred a picker statement', { kind, status: result.status })
      return NextResponse.json(
        { error: 'Snowflake did not return the object list in time. Try again in a moment.' },
        { status: 502 }
      )
    }
    const rows = result.result.rows

    const objects: SnowflakeObject[] =
      kind === 'roles'
        ? parseAvailableRoles(rows[0]?.[0])
        : rows.flatMap((row) => {
            const name = row[0]
            if (typeof name !== 'string' || !name) return []
            return [{ name, detail: typeof row[1] === 'string' ? row[1] : null }]
          })

    return NextResponse.json({ objects })
  } catch (error) {
    logger.error('Failed to list Snowflake objects', { kind, error })
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to list Snowflake objects') },
      { status: upstreamStatus >= 400 && upstreamStatus < 500 ? 400 : 502 }
    )
  }
})
