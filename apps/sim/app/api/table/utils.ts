import { createLogger } from '@sim/logger'
import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { toError } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import {
  asOrchestrationError,
  messageForOrchestrationError,
  type OrchestrationErrorCode,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import type { MultipartError } from '@/lib/core/utils/multipart'
import type { StaticPermissionGroupCapability } from '@/lib/permission-groups/capabilities'
import {
  capabilityRefusal,
  isWorkspaceCapabilityWithheld,
} from '@/lib/permission-groups/capability-assertions'
import { capabilityRefusalResponse } from '@/lib/permission-groups/capability-response'
import type { ColumnDefinition, Filter, TableDefinition, TablePredicate } from '@/lib/table'
import { buildFilterClause, getTableById, TableQueryValidationError } from '@/lib/table'
import { USER_TABLE_ROWS_SQL_NAME } from '@/lib/table/constants'
import { TableLockedError } from '@/lib/table/mutation-locks'
import { isTablePredicate } from '@/lib/table/query-builder/converters'
import { validateStoragePredicate } from '@/lib/table/query-builder/validate'
import type { TableLockKind } from '@/lib/table/types'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceOrganizationId } from '@/lib/workspaces/utils'

/**
 * Gate for the internal predicate-grammar table query route (`tables-v2-api`
 * flag). Runs AFTER authorization, so the caller has already proven read
 * access to the table — hiding the gate behind a bare 404 at that point
 * serves nobody and reads as data loss (live incident: the table_v2 block
 * hard-"Not found"-ing on every query while the copilot gateway, which
 * bypasses HTTP, found the rows). Authorized callers get an honest 403
 * naming the gate instead.
 */
export async function tablesV2GateError(
  userId: string,
  workspaceId: string
): Promise<NextResponse | null> {
  const orgId = await getWorkspaceOrganizationId(workspaceId)
  if (await isFeatureEnabled('tables-v2-api', { userId, orgId })) return null
  return NextResponse.json(
    {
      error: 'The v2 table query API is not enabled for this workspace',
      code: 'tables_v2_disabled',
    },
    { status: 403 }
  )
}

/**
 * Maps a {@link TableLockedError} thrown by the service layer to a 423 response
 * carrying `{ error, lock }`; returns `null` for any other error so the caller
 * falls through to its existing handling. Call this as the FIRST statement of a
 * table route's catch block — `TableLockedError` is an `HttpError`, not an
 * `OrchestrationError`, so nothing else classifies it and it would otherwise
 * reach the route's generic 500.
 *
 * The body deliberately omits a `details` array: the client's `isValidationError`
 * treats any `ApiClientError` with array-valued `details` as a field-validation
 * error and swallows its toast, so a lock rejection must not carry one.
 */
export function tableLockErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof TableLockedError) {
    return NextResponse.json({ error: error.message, lock: error.lock }, { status: 423 })
  }
  return null
}

/**
 * Validates a wire `filter` (either grammar) against the table's column schema,
 * returning a 400 response on a bad field (or `null` when the filter is valid or
 * absent). Shared by the routes that accept a filter (`delete-async`,
 * `cancel-runs`, `columns/run`) so a bad field fails fast with a clear message.
 *
 * Pass the WIRE filter, not the `toLegacyFilter` downgrade: the downgrade
 * compiles cleanly through `buildFilterClause` even when a predicate leaf names
 * a column that doesn't exist, so validating only the downgraded form lets a
 * typo'd field become a clause that silently matches nothing — a no-op where
 * the sync bulk routes 400.
 */
export function tableFilterError(
  filter: Filter | TablePredicate | undefined,
  columns: ColumnDefinition[]
): NextResponse | null {
  if (!filter) return null
  try {
    if (isTablePredicate(filter)) {
      // These routes speak storage keys (session grid uses column ids; system
      // columns keep their names) — same keying the sync bulk routes validate.
      validateStoragePredicate(filter, columns)
    } else {
      buildFilterClause(filter, USER_TABLE_ROWS_SQL_NAME, columns)
    }
    return null
  } catch (error) {
    if (error instanceof TableQueryValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }
}

const logger = createLogger('TableUtils')

/**
 * Deepest `Error` message in the cause chain. Drizzle wraps DB errors in a
 * `DrizzleQueryError` whose own message is just the failed SQL — substring
 * classification must look at the root cause.
 */
export function rootErrorMessage(error: unknown): string {
  let current: unknown = error
  while (current instanceof Error && current.cause instanceof Error) {
    current = current.cause
  }
  return toError(current).message
}

/**
 * Maps a classified domain failure to its status, carrying the real message so
 * client toasts can show the actual reason; `null` when the error carries no
 * classification and the caller should log it and return its own generic 500 —
 * an unrecognized error can hold SQL/internals that don't belong in a toast.
 *
 * This is the whole classification story for the UI and v1 table routes. It
 * replaced per-route lists of message substrings, which decided a status by
 * searching prose and so silently changed one whenever a message was reworded.
 */
export function orchestrationErrorResponse(error: unknown): NextResponse | null {
  // A lock violation is a 423, and `TableLockedError` is an `HttpError` rather
  // than an `OrchestrationError`, so it needs its own check first.
  const lockResponse = tableLockErrorResponse(error)
  if (lockResponse) return lockResponse

  const classified = asOrchestrationError(error)
  if (!classified) return null

  return NextResponse.json(
    { error: classified.message },
    { status: statusForOrchestrationError(classified.code) }
  )
}

/**
 * The failure half of a `lib/table/orchestration` result. Every `perform*`
 * function returns this shape, so one projection serves all of them.
 */
export interface TableOrchestrationFailure {
  error?: string
  errorCode?: OrchestrationErrorCode
  /** Which lock rejected the write. Set only when `errorCode` is `'locked'`. */
  lock?: TableLockKind
}

/**
 * Projects an orchestration failure RESULT onto its HTTP response, the
 * counterpart of {@link orchestrationErrorResponse} for the functions that
 * return a failure instead of throwing one.
 *
 * Routes go through this rather than reading `outcome.error` themselves, for
 * two reasons the per-route spellings kept getting wrong:
 *
 * - An unclassified failure carries whatever text the fault happened to have —
 *   a driver's failed SQL and its bound parameters — so it renders `fallback`
 *   instead. Only a classified, caller-fixable failure keeps its own message.
 * - A `'locked'` failure answers 423 with `{ error, lock }`. The lock kind is
 *   the only thing that tells a client which lock to clear, and it is computed
 *   by every `perform*` function already.
 */
export function orchestrationOutcomeErrorResponse(
  outcome: TableOrchestrationFailure,
  fallback: string
): NextResponse {
  return NextResponse.json(
    {
      error: messageForOrchestrationError(outcome, fallback),
      ...(outcome.lock ? { lock: outcome.lock } : {}),
    },
    { status: statusForOrchestrationError(outcome.errorCode) }
  )
}

/**
 * Next.js buffers the request body for the proxy and silently truncates it past this
 * size (`experimental.proxyClientMaxBodySize`, default 10MB). The synchronous CSV
 * import routes reject bodies over the cap up front; larger files use the async
 * direct-to-storage path instead.
 */
export const CSV_IMPORT_PROXY_BODY_CAP_BYTES = 10 * 1024 * 1024

/** 413 response when a synchronous CSV upload would exceed (and be truncated at) the proxy cap; `null` otherwise. */
export function csvProxyBodyCapResponse(request: { headers: Headers }): NextResponse | null {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > CSV_IMPORT_PROXY_BODY_CAP_BYTES) {
    return NextResponse.json(
      {
        error:
          'File too large to import through the server. Files over 10MB import in the background.',
      },
      { status: 413 }
    )
  }
  return null
}

/** Maps a {@link MultipartError} from the streaming CSV parser to its HTTP response. */
export function multipartErrorResponse(error: MultipartError): NextResponse {
  if (error.code === 'FILE_TOO_LARGE') {
    return NextResponse.json({ error: 'CSV import file exceeds maximum size' }, { status: 413 })
  }
  const message =
    error.code === 'NO_FILE' ? 'CSV file is required' : `Invalid CSV upload: ${error.message}`
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * A denial carries `capability` when the caller's permission group withheld the
 * Tables module, so {@link accessError} can say so rather than reporting the
 * role failure it is not. Optional because the other two denials — the table
 * does not exist, the role is too low — have no capability to name.
 */
export type AccessResult =
  | { ok: true; table: TableDefinition }
  | { ok: false; status: 404 | 403; capability?: StaticPermissionGroupCapability }

interface ApiErrorResponse {
  error: string
  details?: unknown
}

/**
 * Who is asking, for the purposes of {@link checkAccess}.
 *
 * A discriminated union rather than a user id, because the two kinds are
 * indistinguishable as strings and the gate must treat them differently:
 *
 * - `user` — a session, an internal JWT acting as the person, or a personal API
 *   key. There is a real person behind the request, so their permission group
 *   governs it and `tables.use` applies.
 * - `workspace_api_key` — a shared credential that authorizes as the workspace
 *   itself. It has no user, so there is no group to resolve.
 *   `keyCreatorUserId` is the id `authenticateApiKeyFromHeader` reports: the
 *   person who *minted* the key, a bystander who may not even be the caller. It
 *   carries the workspace role check that predates this union and nothing else.
 *   Same rule, and the same reasoning, as `capabilityGovernedPrincipalUserId` in
 *   `@/lib/core/application`.
 *
 * Required, and with no permissive default, for the same reason `capability` is
 * required on `defineWorkspaceOperation`: an absent declaration cannot be told
 * apart from an unreviewed one. A caller holding a workspace key cannot reach
 * the gated behavior by passing a bare id, because a bare id no longer
 * type-checks — it has to name a kind, and the only kind that skips the gate is
 * the one that says so.
 */
export type TableAccessPrincipal =
  | { kind: 'user'; userId: string }
  | { kind: 'workspace_api_key'; keyCreatorUserId: string }

/** The id the workspace ROLE check runs against, for either principal kind. */
function roleSubjectUserId(principal: TableAccessPrincipal): string {
  return principal.kind === 'user' ? principal.userId : principal.keyCreatorUserId
}

/**
 * The id whose permission group governs the request, or `null` when no group
 * does. Only a `user` principal has one — see {@link TableAccessPrincipal}.
 *
 * Exported because the gate is not the only thing that needs the subject: a
 * write that lands rows auto-fires the table's workflow and enrichment cells,
 * and those cells must run under the same person this check just gated, not
 * under whatever id the surface had nearest. One statement of the rule, so a
 * route cannot gate one subject and dispatch another.
 */
export function capabilityGovernedUserId(principal: TableAccessPrincipal): string | null {
  return principal.kind === 'user' ? principal.userId : null
}

/**
 * Access check returning `{ ok, table }` or `{ ok: false, status }`.
 *
 * The workspace role, then the permission group's `tables.use` capability — the
 * one gate every raw table route under `/api/table/**` shares. These routes
 * predate the operation boundary and query the table service directly, so the
 * authorization funnel that applies `tables.use` to `tableOperations` never
 * sees them; without this a member of a group denied Tables could still drive
 * all of them.
 *
 * Capability comes second for the same reason it does in
 * `authorizeWorkspaceOperation`: the role failure conceals whether the table
 * exists, and refusing on capability first would tell a non-member which
 * modules the organization withholds.
 *
 * The gate applies to a `user` principal only; see {@link TableAccessPrincipal}
 * for why `/api/v1/tables/**`, which shares this helper under an API key, must
 * reach the table ungated on a workspace key.
 *
 * Nothing here exempts the executor. A workflow run reaches tables through
 * `tableOperations`, where the delegated-principal branch already withholds
 * capabilities from an executor subject; these HTTP routes are UI surfaces, and
 * the internal-JWT branch of `checkSessionOrInternalAuth` acts as the person.
 */
export async function checkAccess(
  tableId: string,
  principal: TableAccessPrincipal,
  level: 'read' | 'write' | 'admin' = 'read'
): Promise<AccessResult> {
  const table = await getTableById(tableId)

  if (!table) {
    return { ok: false, status: 404 }
  }

  const permission = await getUserEntityPermissions(
    roleSubjectUserId(principal),
    'workspace',
    table.workspaceId
  )
  if (!permissionSatisfies(permission, level)) {
    return { ok: false, status: 403 }
  }

  // permission-group-enforced: tables.use — raw routes that query directly and predate the operation boundary
  const governedUserId = capabilityGovernedUserId(principal)
  if (
    governedUserId &&
    table.workspaceId &&
    (await isWorkspaceCapabilityWithheld(governedUserId, table.workspaceId, 'tables.use'))
  ) {
    return { ok: false, status: 403, capability: 'tables.use' }
  }

  return { ok: true, table }
}

export function accessError(
  result: Extract<AccessResult, { ok: false }>,
  requestId: string,
  context?: string
): NextResponse {
  if (result.capability) {
    logger.warn(
      `[${requestId}] ${capabilityRefusal(result.capability)}${context ? `: ${context}` : ''}`
    )
    return capabilityRefusalResponse(result.capability)
  }

  const message = result.status === 404 ? 'Table not found' : 'Access denied'
  logger.warn(`[${requestId}] ${message}${context ? `: ${context}` : ''}`)
  return NextResponse.json({ error: message }, { status: result.status })
}

export function errorResponse(
  message: string,
  status: number,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  const body: ApiErrorResponse = { error: message }
  if (details !== undefined) {
    body.details = details
  }
  return NextResponse.json(body, { status })
}

export function badRequestResponse(message: string, details?: unknown) {
  return errorResponse(message, 400, details)
}

export function unauthorizedResponse(message = 'Authentication required') {
  return errorResponse(message, 401)
}

export function forbiddenResponse(message = 'Access denied') {
  return errorResponse(message, 403)
}

export function notFoundResponse(message = 'Resource not found') {
  return errorResponse(message, 404)
}
