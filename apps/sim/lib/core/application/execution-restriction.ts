import { AsyncLocalStorage } from 'node:async_hooks'
import {
  type ExternalMailerRestriction,
  type Principal,
  parseExternalMailerRestriction,
} from '@sim/auth/principal'
import type { ApplicationOperation } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const restrictions = new AsyncLocalStorage<ExternalMailerRestriction>()

/** Nested in-process adapters cannot replace or omit their caller's restriction. */
export function resolveExecutionRestriction(
  supplied?: ExternalMailerRestriction
): ExternalMailerRestriction | undefined {
  const inherited = restrictions.getStore()
  const parsed = supplied === undefined ? undefined : parseExternalMailerRestriction(supplied)
  if (
    inherited &&
    parsed &&
    (inherited.admissionId !== parsed.admissionId ||
      inherited.inboxTaskId !== parsed.inboxTaskId ||
      inherited.workspaceId !== parsed.workspaceId)
  ) {
    throw new OrchestrationError('forbidden', 'Execution admission cannot change during delegation')
  }
  return inherited ?? parsed
}

export function withExecutionRestriction<T>(
  supplied: ExternalMailerRestriction | undefined,
  execute: () => T
): T {
  const restriction = resolveExecutionRestriction(supplied)
  return restriction ? restrictions.run(restriction, execute) : execute()
}

export function requireRestrictedOperation(
  principal: Principal,
  operation: ApplicationOperation,
  workspaceId?: string
): void {
  const restriction = resolveExecutionRestriction(
    principal.kind === 'delegated' ? principal.executionRestriction : undefined
  )
  if (!restriction) return
  if (
    principal.kind !== 'delegated' ||
    principal.serviceId !== 'copilot' ||
    principal.workspaceId !== restriction.workspaceId ||
    (workspaceId !== undefined && workspaceId !== restriction.workspaceId) ||
    operation.restrictedExternalAccess !== 'workspace_read' ||
    ('minimumRole' in operation && operation.minimumRole !== 'read')
  ) {
    throw new OrchestrationError('forbidden', 'Operation unavailable to external Mailer senders')
  }
}

export function requireUnrestrictedExecution(supplied?: ExternalMailerRestriction): void {
  if (resolveExecutionRestriction(supplied)) {
    throw new OrchestrationError('forbidden', 'Operation unavailable to external Mailer senders')
  }
}
