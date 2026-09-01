import type { Principal } from '@sim/auth/principal'
import {
  DelegatedWorkspaceAuthorizationError,
  NoWorkspaceAccessError,
  type WorkspaceAuthorizationContext,
  type WorkspaceDelegationPolicy,
} from '@/lib/core/application'

export const LOGS_DELEGATION_AUDIENCE = 'sim:logs'

export interface LogAuthorizationContext extends WorkspaceAuthorizationContext {
  executionId?: string
}

export const logDelegationPolicy: WorkspaceDelegationPolicy<LogAuthorizationContext> = {
  audience: LOGS_DELEGATION_AUDIENCE,
  isWithinScope(
    _principal: Extract<Principal, { kind: 'delegated' }>,
    _context: LogAuthorizationContext
  ) {
    return true
  },
}

export function logDelegationAuthorization<C extends LogAuthorizationContext>() {
  return {
    delegation: logDelegationPolicy as WorkspaceDelegationPolicy<C>,
  }
}

export function isConcealedLogAuthorizationError(error: unknown): boolean {
  return (
    error instanceof NoWorkspaceAccessError || error instanceof DelegatedWorkspaceAuthorizationError
  )
}
