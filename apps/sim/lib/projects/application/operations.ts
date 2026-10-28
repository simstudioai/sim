import type { ApplicationOperation } from '@/lib/core/application/operation'
import { assertOperationCapability, defineOperation } from '@/lib/core/application/operation'

export interface ProjectOperation extends ApplicationOperation {
  readonly principalKinds: readonly ('session' | 'resource_delegated')[]
  readonly access: 'read' | 'admin' | 'issues'
  readonly delegationAudience?: string
  readonly delegatedServices?: readonly ['copilot']
}

export const PROJECT_DISCOVERY_DELEGATION_TTL_MS = 60_000

/** Project operations cannot borrow authority from workspace keys or an arbitrary root. */
function defineProjectOperation<const O extends ProjectOperation>(operation: O): O {
  assertOperationCapability(operation)
  if (
    operation.principalKinds.includes('resource_delegated') &&
    (operation.id !== 'projects.list' ||
      operation.access !== 'read' ||
      !operation.delegationAudience)
  )
    throw new Error('Resource delegation is available only for bounded Project discovery')
  Object.freeze(operation.principalKinds)
  if (operation.delegatedServices) Object.freeze(operation.delegatedServices)
  return Object.freeze(operation)
}

export const projectOperations = {
  create: defineOperation({
    id: 'projects.create',
    principalKinds: ['session'],
    capability: 'workspace.create',
  }),
  // permission-group-exempt: navigation exposes only Projects containing accessible environments.
  list: defineProjectOperation({
    id: 'projects.list',
    principalKinds: ['session', 'resource_delegated'],
    access: 'read',
    capability: 'none',
    delegationAudience: 'sim:projects:discovery',
    delegatedServices: ['copilot'],
  }),
  // permission-group-exempt: Project metadata does not grant access to its Issues or environments.
  get: defineProjectOperation({
    id: 'projects.get',
    principalKinds: ['session'],
    access: 'read',
    capability: 'none',
  }),
  // permission-group-exempt: Project names are administered by org admins or admins of every environment.
  rename: defineProjectOperation({
    id: 'projects.rename',
    principalKinds: ['session'],
    access: 'admin',
    capability: 'none',
  }),
  // permission-group-exempt: archival revokes execution rather than granting a governed capability.
  archive: defineProjectOperation({
    id: 'projects.archive',
    principalKinds: ['session'],
    access: 'admin',
    capability: 'none',
  }),
  // permission-group-exempt: project_issues.use is parameterized by Project ID and checked after access.
  issues: defineProjectOperation({
    id: 'projects.issues.access',
    principalKinds: ['session'],
    access: 'issues',
    capability: 'none',
  }),
} as const
