import { AsyncLocalStorage } from 'node:async_hooks'
import { OrchestrationError } from '@/lib/core/orchestration/types'

interface WorkspaceInvocationScope {
  workspaceId: string
  organizationId?: string
  insideAuthorizedOperation: boolean
}
const scope = new AsyncLocalStorage<Readonly<WorkspaceInvocationScope>>()

/** Server-validated invocation targets constrain canonical application context, including ID-only routes. */
export function withWorkspaceInvocationScope<T>(
  target: { workspaceId: string; organizationId?: string },
  execute: () => T
): T {
  return scope.run(Object.freeze({ ...target, insideAuthorizedOperation: false }), execute)
}

export function assertWorkspaceInvocationScope(context: {
  workspaceId: string
  workspaceOrganizationId?: string | null
}): void {
  const target = scope.getStore()
  if (!target || target.insideAuthorizedOperation) return
  if (
    context.workspaceId !== target.workspaceId ||
    (target.organizationId && context.workspaceOrganizationId !== target.organizationId)
  ) {
    throw new OrchestrationError('not_found', 'Resource not found in the selected workspace')
  }
}

/** Nested compound operations retain their own explicit secondary authorization after primary admission. */
export function withinAuthorizedWorkspaceOperation<T>(execute: () => T): T {
  const target = scope.getStore()
  return target
    ? scope.run(Object.freeze({ ...target, insideAuthorizedOperation: true }), execute)
    : execute()
}
