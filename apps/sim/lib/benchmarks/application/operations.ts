import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const policy = {
  minimumRole: 'member',
  principalKinds: ['session'],
} as const

export const benchmarkOperations = {
  list: defineOrganizationOperation({
    id: 'benchmarks.list',
    capability: 'copilot.use',
    ...policy,
  }),
  read: defineOrganizationOperation({
    id: 'benchmarks.read',
    capability: 'copilot.use',
    ...policy,
  }),
  listRuns: defineOrganizationOperation({
    id: 'benchmarks.runs.list',
    capability: 'copilot.use',
    ...policy,
  }),
  readRun: defineOrganizationOperation({
    id: 'benchmarks.runs.read',
    capability: 'copilot.use',
    ...policy,
  }),
  reviewRun: defineOrganizationOperation({
    id: 'benchmarks.runs.review',
    capability: 'copilot.use',
    ...policy,
  }),
  create: defineOrganizationOperation({
    id: 'benchmarks.create',
    capability: 'copilot.use',
    ...policy,
  }),
  update: defineOrganizationOperation({
    id: 'benchmarks.update',
    capability: 'copilot.use',
    ...policy,
  }),
  delete: defineOrganizationOperation({
    id: 'benchmarks.delete',
    capability: 'copilot.use',
    ...policy,
  }),
  run: defineOrganizationOperation({ id: 'benchmarks.run', capability: 'copilot.use', ...policy }),
} as const

export const benchmarkSourceOperation = defineWorkspaceOperation({
  id: 'benchmarks.source.read',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['session'],
  capability: 'copilot.use',
})
