import { NextResponse } from 'next/server'
import type { AnyApiRouteContract } from '@/lib/api/contracts'
import type { ApplicationOperation, OperationUseCase } from '@/lib/core/application'

interface JsonRouteDefinitionMetadata {
  successStatus: number
  successStatuses: readonly number[]
}

export function requireJsonRouteDefinition(
  contract: AnyApiRouteContract,
  declaredOperation: ApplicationOperation,
  useCaseOperation: ApplicationOperation
): JsonRouteDefinitionMetadata {
  if (contract.response.mode !== 'json') {
    throw new Error(`${contract.method} ${contract.path} requires a JSON response contract`)
  }
  if (declaredOperation.id !== useCaseOperation.id) {
    throw new Error(
      `Route operation ${declaredOperation.id} does not match use case ${useCaseOperation.id}`
    )
  }

  return declaredSuccessStatuses(contract)
}

/** Statuses a response body can't accompany, so never a binary route's default. */
const BODYLESS_STATUSES = new Set([204, 205])

export function requireBinaryRouteDefinition(
  contract: AnyApiRouteContract,
  declaredOperation: ApplicationOperation,
  useCaseOperation: ApplicationOperation
): JsonRouteDefinitionMetadata {
  if (contract.response.mode !== 'binary') {
    throw new Error(`${contract.method} ${contract.path} requires a binary response contract`)
  }
  if (declaredOperation.id !== useCaseOperation.id) {
    throw new Error(
      `Route operation ${declaredOperation.id} does not match use case ${useCaseOperation.id}`
    )
  }
  const metadata = declaredSuccessStatuses(contract)
  if (BODYLESS_STATUSES.has(metadata.successStatus)) {
    throw new Error(
      `${contract.method} ${contract.path} must list a status that carries a body first; it is the status a body is served with`
    )
  }
  return metadata
}

/** The contract's success statuses, 200 by default; the first is a route's default status. */
function declaredSuccessStatuses(contract: AnyApiRouteContract): JsonRouteDefinitionMetadata {
  const configuredStatus = contract.response.status
  const successStatuses =
    configuredStatus === undefined
      ? [200]
      : Array.isArray(configuredStatus)
        ? [...configuredStatus]
        : [configuredStatus]
  if (successStatuses.length === 0) {
    throw new Error(`${contract.method} ${contract.path} must declare a success status`)
  }
  if (new Set(successStatuses).size !== successStatuses.length) {
    throw new Error(`${contract.method} ${contract.path} repeats a success status`)
  }
  for (const status of successStatuses) {
    if (!Number.isInteger(status) || status < 200 || status >= 300) {
      throw new Error(`${contract.method} ${contract.path} has a non-success response status`)
    }
  }
  return { successStatus: successStatuses[0], successStatuses }
}

/**
 * Whether an incoming request's method is the one its contract declares.
 *
 * `HEAD` satisfies a `GET` contract because Next aliases a missing `HEAD`
 * export straight to the `GET` handler
 * (`auto-implement-methods.ts`: `methods.HEAD = handlers.GET`) and then drops
 * the body when sending (`send-response.ts` skips the stream when
 * `req.method === 'HEAD'`). So the handler legitimately runs with
 * `request.method === 'HEAD'` against a `GET` contract, and rejecting that made
 * every v2 read answer 500 to a plain `HEAD` — the request health checkers,
 * uptime monitors, and link checkers send. RFC 9110 §9.3.2 makes HEAD identical
 * to GET but for the body, which is exactly what running the GET path and
 * letting the framework strip the body produces.
 *
 * Everything else stays a hard error: a handler exported under the wrong verb is
 * a wiring mistake that should fail loudly rather than serve the wrong contract.
 */
export function methodMatchesContract(requestMethod: string, contractMethod: string): boolean {
  if (requestMethod === contractMethod) return true
  return requestMethod === 'HEAD' && contractMethod === 'GET'
}

/**
 * Refuses at module load to build a `headSafe: false` route whose use case
 * cannot answer the authorization question on its own — see the `headSafe`
 * option on the v2 and internal route builders. A use case with no `authorize`
 * leaves the builder nothing but admission to answer a `HEAD` from, so the gap
 * is a boot failure rather than a silent 200.
 */
export function requireHeadAuthorizableUseCase(
  contract: { method: string; path: string },
  headSafe: boolean | undefined,
  useCase: Pick<OperationUseCase<ApplicationOperation, unknown, unknown>, 'authorize'>
): void {
  if (headSafe !== false) return
  if (typeof useCase.authorize === 'function') return
  throw new Error(
    `Route ${contract.method} ${contract.path} declares headSafe: false but its use case has no authorize(); a HEAD would have to answer from authentication alone and would leak the resource's existence.`
  )
}

/**
 * `Cache-Control` for a response carrying an `ETag`: a private cache may keep it but must
 * revalidate it on every use, which is what the tag is for (`no-store` would forbid keeping it,
 * so the tag could never be sent back).
 */
export const REVALIDATE_CACHE_CONTROL = 'private, no-cache'

/**
 * Whether the request's `If-None-Match` names `entityTag` (quoted) or `*`. Comparison is weak
 * (RFC 9110 §13.1.2), so `W/` prefixes are ignored.
 */
export function entityTagMatches(request: Request, entityTag: string): boolean {
  const header = request.headers.get('if-none-match')
  if (!header) return false
  return header
    .split(',')
    .map((candidate) => candidate.trim().replace(/^W\//, ''))
    .some((candidate) => candidate === '*' || candidate === entityTag)
}

/** The bodiless `304` for a request whose `If-None-Match` matched `entityTag`. */
export function notModifiedResponse(entityTag: string): NextResponse {
  return new NextResponse(null, {
    status: 304,
    headers: { 'Cache-Control': REVALIDATE_CACHE_CONTROL, ETag: entityTag },
  })
}
