import { defineOperation } from '@/lib/core/application/operation'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

export const benchmarkOperations = {
  /** permission-group-exempt: platform superusers administer benchmarks; selected-user capabilities are checked separately. */
  preparePlan: defineOperation({
    id: 'benchmarks.plan.prepare',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /** permission-group-exempt: platform superusers administer benchmarks; selected-user capabilities are checked separately. */
  list: defineOperation({
    id: 'benchmarks.list',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /** permission-group-exempt: platform superusers administer benchmarks; selected-user capabilities are checked separately. */
  read: defineOperation({
    id: 'benchmarks.read',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /** permission-group-exempt: platform superusers administer benchmarks; selected-user capabilities are checked separately. */
  listRuns: defineOperation({
    id: 'benchmarks.runs.list',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /** permission-group-exempt: platform superusers administer benchmarks; selected-user capabilities are checked separately. */
  readRun: defineOperation({
    id: 'benchmarks.runs.read',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /** permission-group-exempt: platform superusers administer benchmarks; selected-user capabilities are checked separately. */
  reviewRun: defineOperation({
    id: 'benchmarks.runs.review',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /** permission-group-exempt: platform superusers administer benchmarks; selected-user capabilities are checked separately. */
  create: defineOperation({
    id: 'benchmarks.create',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /** permission-group-exempt: platform superusers administer benchmarks; selected-user capabilities are checked separately. */
  update: defineOperation({
    id: 'benchmarks.update',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /** permission-group-exempt: platform superusers administer benchmarks; selected-user capabilities are checked separately. */
  delete: defineOperation({
    id: 'benchmarks.delete',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /** permission-group-exempt: platform superusers administer benchmarks; selected-user capabilities are checked separately. */
  organizations: defineOperation({
    id: 'benchmarks.organizations.list',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /** permission-group-exempt: platform superusers administer benchmarks; selected-user capabilities are checked separately. */
  users: defineOperation({
    id: 'benchmarks.users.list',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /** permission-group-exempt: platform superusers administer benchmarks; selected-user capabilities are checked separately. */
  workspaces: defineOperation({
    id: 'benchmarks.workspaces.list',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /** permission-group-exempt: platform superusers administer benchmarks; selected-user capabilities are checked separately. */
  availability: defineOperation({
    id: 'benchmarks.availability',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /** permission-group-exempt: platform superusers administer benchmarks; selected-user capabilities are checked separately. */
  run: defineOperation({
    id: 'benchmarks.run',
    principalKinds: ['session'],
    capability: 'none',
  }),
} as const

export const benchmarkSourceOperation = defineWorkspaceOperation({
  id: 'benchmarks.source.read',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
  capability: 'copilot.use',
})
