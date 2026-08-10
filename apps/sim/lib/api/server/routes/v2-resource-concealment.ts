import type { V2ErrorPolicy } from '@/lib/api/server/routes/v2-json-route'
import {
  DelegatedWorkspaceAuthorizationError,
  InsufficientWorkspacePermissionsError,
  PrincipalKindAuthorizationError,
  WorkspaceApiKeyAuthorizationError,
} from '@/lib/core/application'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

type V2ErrorRenderer = V2ErrorPolicy['render']

function isResourceAuthorizationError(error: unknown): boolean {
  return (
    error instanceof DelegatedWorkspaceAuthorizationError ||
    error instanceof InsufficientWorkspacePermissionsError ||
    error instanceof PrincipalKindAuthorizationError ||
    error instanceof WorkspaceApiKeyAuthorizationError
  )
}

/** Conceals only typed resource-authorization failures without hiding workspace policy denials. */
export function createV2ResourceConcealmentPolicy(options: {
  notFoundMessage: string
  render?: V2ErrorRenderer
}): V2ErrorPolicy {
  const render = options.render ?? v2CaughtOrchestrationError
  return {
    render(error) {
      if (isResourceAuthorizationError(error)) {
        return v2Error('NOT_FOUND', options.notFoundMessage)
      }
      return render(error)
    },
  }
}
