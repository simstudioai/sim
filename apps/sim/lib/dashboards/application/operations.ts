import { defineWorkspaceOperation } from '@/lib/core/application'

const policy = {
  workspaceApiKey: 'deny',
  principalKinds: ['session', 'delegated'],
  delegatedServices: ['copilot'],
} as const

/** The workspace dashboard retains the access policy of its file-backed storage. */
export const dashboardOperations = {
  read: defineWorkspaceOperation({
    ...policy,
    capability: 'files.use',
    id: 'dashboards.read',
    minimumRole: 'read',
  }),
  save: defineWorkspaceOperation({
    ...policy,
    capability: 'files.use',
    id: 'dashboards.save',
    minimumRole: 'write',
  }),
} as const
export type DashboardOperation = (typeof dashboardOperations)[keyof typeof dashboardOperations]
