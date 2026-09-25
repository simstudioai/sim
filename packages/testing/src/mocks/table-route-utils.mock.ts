import { getErrorMessage } from '@sim/utils/errors'
import { vi } from 'vitest'

interface MockOrchestrationFailure {
  error?: string
  errorCode?: string
  lock?: string
}

type MockAccessDenial = { ok: false; status: number; capability?: string }

type MockTableAccessPrincipal =
  | { kind: 'user'; userId: string }
  | { kind: 'workspace_api_key'; keyCreatorUserId: string }

const ORCHESTRATION_ERROR_CODES = new Set([
  'validation',
  'unauthorized',
  'not_found',
  'forbidden',
  'conflict',
  'locked',
  'payload_too_large',
  'internal',
])

const CAPABILITY_DESCRIPTIONS: Record<string, string> = { 'tables.use': 'The Tables module' }

function statusForCode(code: string | undefined): number {
  if (code === 'validation') return 400
  if (code === 'unauthorized') return 401
  if (code === 'forbidden') return 403
  if (code === 'not_found') return 404
  if (code === 'conflict') return 409
  if (code === 'locked') return 423
  if (code === 'payload_too_large') return 413
  return 500
}

function classifiedError(error: unknown): (Error & { code: string }) | null {
  let current: unknown = error
  while (current instanceof Error) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && ORCHESTRATION_ERROR_CODES.has(code)) {
      return current as Error & { code: string }
    }
    current = current.cause
  }
  return null
}

function lockResponse(error: unknown): Response | null {
  if (error instanceof Error && error.name === 'TableLockedError') {
    return Response.json(
      { error: error.message, lock: (error as { lock?: unknown }).lock },
      { status: 423 }
    )
  }
  return null
}

function errorResponse(message: string, status: number, details?: unknown): Response {
  return Response.json(details !== undefined ? { error: message, details } : { error: message }, {
    status,
  })
}

/**
 * Controllable mock functions for `@/app/api/table/utils`.
 *
 * The response helpers default to faithful ports that build a web `Response` (not `NextResponse`):
 * `tableLockErrorResponse` (423 for any `Error` named `TableLockedError`, else `null`),
 * `orchestrationErrorResponse` / `orchestrationOutcomeErrorResponse` (real status map and message
 * rule; an error is "classified" when it or its `cause` chain carries a known orchestration `code`),
 * `rootErrorMessage`, `csvProxyBodyCapResponse`, `multipartErrorResponse`,
 * `capabilityGovernedUserId`, `accessError`, `errorResponse`, `badRequestResponse`,
 * `unauthorizedResponse`, `forbiddenResponse`, `notFoundResponse`.
 * `tablesV2GateError` resolves `null` (the gate is open); `tableFilterError` returns `null` (the
 * filter is valid). `checkAccess` is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { tableRouteUtilsMockFns } from '@sim/testing/mocks/table-route-utils.mock'
 *
 * tableRouteUtilsMockFns.mockCheckAccess.mockResolvedValue({ ok: true, table })
 * ```
 */
export const tableRouteUtilsMockFns = {
  mockTablesV2GateError: vi.fn(
    async (_userId: string, _workspaceId: string): Promise<Response | null> => null
  ),
  mockTableLockErrorResponse: vi.fn((error: unknown): Response | null => lockResponse(error)),
  mockTableFilterError: vi.fn((_filter: unknown, _columns: unknown): Response | null => null),
  mockRootErrorMessage: vi.fn((error: unknown): string => {
    let current: unknown = error
    while (current instanceof Error && current.cause instanceof Error) current = current.cause
    return getErrorMessage(current, String(current))
  }),
  mockOrchestrationErrorResponse: vi.fn((error: unknown): Response | null => {
    const locked = lockResponse(error)
    if (locked) return locked
    const classified = classifiedError(error)
    if (!classified) return null
    return Response.json({ error: classified.message }, { status: statusForCode(classified.code) })
  }),
  mockOrchestrationOutcomeErrorResponse: vi.fn(
    (outcome: MockOrchestrationFailure, fallback: string): Response =>
      Response.json(
        {
          error:
            !outcome.errorCode || outcome.errorCode === 'internal'
              ? fallback
              : (outcome.error ?? fallback),
          ...(outcome.lock ? { lock: outcome.lock } : {}),
        },
        { status: statusForCode(outcome.errorCode) }
      )
  ),
  mockCsvProxyBodyCapResponse: vi.fn((request: { headers: Headers }): Response | null => {
    const contentLength = Number(request.headers.get('content-length') ?? 0)
    if (contentLength > 10 * 1024 * 1024) {
      return Response.json(
        {
          error:
            'File too large to import through the server. Files over 10MB import in the background.',
        },
        { status: 413 }
      )
    }
    return null
  }),
  mockMultipartErrorResponse: vi.fn((error: { code: string; message: string }): Response => {
    if (error.code === 'FILE_TOO_LARGE') {
      return Response.json({ error: 'CSV import file exceeds maximum size' }, { status: 413 })
    }
    const message =
      error.code === 'NO_FILE' ? 'CSV file is required' : `Invalid CSV upload: ${error.message}`
    return Response.json({ error: message }, { status: 400 })
  }),
  mockCapabilityGovernedUserId: vi.fn((principal: MockTableAccessPrincipal): string | null =>
    principal.kind === 'user' ? principal.userId : null
  ),
  mockCheckAccess: vi.fn(),
  mockAccessError: vi.fn(
    (result: MockAccessDenial, _requestId?: string, _context?: string): Response => {
      if (result.capability) {
        const describe = CAPABILITY_DESCRIPTIONS[result.capability] ?? result.capability
        return Response.json(
          {
            error: `${describe} is not available under your organization's permission group`,
            details: { code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' },
          },
          { status: 403 }
        )
      }
      const message = result.status === 404 ? 'Table not found' : 'Access denied'
      return Response.json({ error: message }, { status: result.status })
    }
  ),
  mockErrorResponse: vi.fn(errorResponse),
  mockBadRequestResponse: vi.fn(
    (message: string, details?: unknown): Response => errorResponse(message, 400, details)
  ),
  mockUnauthorizedResponse: vi.fn(
    (message = 'Authentication required'): Response => errorResponse(message, 401)
  ),
  mockForbiddenResponse: vi.fn(
    (message = 'Access denied'): Response => errorResponse(message, 403)
  ),
  mockNotFoundResponse: vi.fn(
    (message = 'Resource not found'): Response => errorResponse(message, 404)
  ),
}

/**
 * Static mock module for `@/app/api/table/utils`. `CSV_IMPORT_PROXY_BODY_CAP_BYTES` carries the
 * real value.
 *
 * @example
 * ```ts
 * vi.mock('@/app/api/table/utils', () => tableRouteUtilsMock)
 * ```
 */
export const tableRouteUtilsMock = {
  CSV_IMPORT_PROXY_BODY_CAP_BYTES: 10 * 1024 * 1024,
  tablesV2GateError: tableRouteUtilsMockFns.mockTablesV2GateError,
  tableLockErrorResponse: tableRouteUtilsMockFns.mockTableLockErrorResponse,
  tableFilterError: tableRouteUtilsMockFns.mockTableFilterError,
  rootErrorMessage: tableRouteUtilsMockFns.mockRootErrorMessage,
  orchestrationErrorResponse: tableRouteUtilsMockFns.mockOrchestrationErrorResponse,
  orchestrationOutcomeErrorResponse: tableRouteUtilsMockFns.mockOrchestrationOutcomeErrorResponse,
  csvProxyBodyCapResponse: tableRouteUtilsMockFns.mockCsvProxyBodyCapResponse,
  multipartErrorResponse: tableRouteUtilsMockFns.mockMultipartErrorResponse,
  capabilityGovernedUserId: tableRouteUtilsMockFns.mockCapabilityGovernedUserId,
  checkAccess: tableRouteUtilsMockFns.mockCheckAccess,
  accessError: tableRouteUtilsMockFns.mockAccessError,
  errorResponse: tableRouteUtilsMockFns.mockErrorResponse,
  badRequestResponse: tableRouteUtilsMockFns.mockBadRequestResponse,
  unauthorizedResponse: tableRouteUtilsMockFns.mockUnauthorizedResponse,
  forbiddenResponse: tableRouteUtilsMockFns.mockForbiddenResponse,
  notFoundResponse: tableRouteUtilsMockFns.mockNotFoundResponse,
}
