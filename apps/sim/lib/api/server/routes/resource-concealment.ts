import type { InternalErrorPolicy } from '@/lib/api/server/routes/internal-json-route'
import type { V2ErrorPolicy } from '@/lib/api/server/routes/v2-json-route'
import {
  DelegatedWorkspaceAuthorizationError,
  NoWorkspaceAccessError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

type V2ErrorRenderer = V2ErrorPolicy['render']

/**
 * Authorization failures proving the caller has no reach into the resource's
 * workspace at all, as opposed to a workspace member whose role is too low.
 * Answering these with `403` confirms the resource exists to a caller who was
 * never entitled to learn that.
 */
function isCrossTenantAuthorizationError(error: unknown): boolean {
  return (
    error instanceof DelegatedWorkspaceAuthorizationError ||
    error instanceof NoWorkspaceAccessError ||
    error instanceof WorkspaceApiKeyScopeAuthorizationError
  )
}

/**
 * The failure a caller should see in place of `error`: an absent resource when
 * the denial was cross-tenant, and `error` itself otherwise.
 *
 * Routes that classify their own failures instead of delegating to an error
 * policy — the raw `withRouteHandler` exceptions — run their caught value
 * through this before classifying it, so they conceal the same way the
 * policy-driven routes beside them do.
 */
export function concealCrossTenantResourceError(error: unknown, notFoundMessage: string): unknown {
  if (!isCrossTenantAuthorizationError(error)) return error
  return new OrchestrationError('not_found', notFoundMessage)
}

/**
 * Conceals cross-tenant authorization failures while preserving same-workspace
 * policy and role denials as 403 responses.
 */
export function createV2ResourceConcealmentPolicy(options: {
  notFoundMessage: string
  render?: V2ErrorRenderer
}): V2ErrorPolicy {
  const render = options.render ?? v2CaughtOrchestrationError
  return {
    render(error) {
      if (isCrossTenantAuthorizationError(error)) {
        return v2Error('NOT_FOUND', options.notFoundMessage)
      }
      return render(error)
    },
  }
}

/**
 * The internal-surface counterpart of {@link createV2ResourceConcealmentPolicy}.
 *
 * The same application use case is reachable from both `/api/v2/...` and the
 * internal `/api/...` routes, so a surface answering `403` where the other
 * answers `404` hands back the resource-existence signal the v2 policy exists to
 * withhold. The concealed failure is re-projected through `base` as a
 * `not_found` orchestration error rather than built directly, so each domain's
 * own error body — the legacy workflow `code` field, the shared `requestId`
 * stamp — matches what its ordinary 404s already return.
 */
export function createInternalResourceConcealmentPolicy(options: {
  base: InternalErrorPolicy
  notFoundMessage: string
}): InternalErrorPolicy {
  if (!options.notFoundMessage.trim()) {
    throw new Error('A concealed internal resource requires a not-found message')
  }
  return {
    project(error) {
      return options.base.project(concealCrossTenantResourceError(error, options.notFoundMessage))
    },
    unhandled: options.base.unhandled,
  }
}
