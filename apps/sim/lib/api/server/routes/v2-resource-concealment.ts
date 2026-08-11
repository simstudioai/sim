import type { V2ErrorPolicy } from '@/lib/api/server/routes/v2-json-route'
import {
  DelegatedWorkspaceAuthorizationError,
  NoWorkspaceAccessError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

type V2ErrorRenderer = V2ErrorPolicy['render']

function isCrossTenantAuthorizationError(error: unknown): boolean {
  return (
    error instanceof DelegatedWorkspaceAuthorizationError ||
    error instanceof NoWorkspaceAccessError ||
    error instanceof WorkspaceApiKeyScopeAuthorizationError
  )
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
