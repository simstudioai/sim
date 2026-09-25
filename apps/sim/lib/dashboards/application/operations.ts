import { defineWorkspaceOperation } from '@/lib/core/application'

const policy = {
  workspaceApiKey: 'deny',
  principalKinds: ['session', 'delegated'],
  delegatedServices: ['copilot'],
} as const

/** Dashboards retain the access policy of their file-backed storage. */
export const dashboardOperations = {
  list: defineWorkspaceOperation({
    ...policy,
    capability: 'files.use',
    id: 'dashboards.list',
    minimumRole: 'read',
  }),
  read: defineWorkspaceOperation({
    ...policy,
    capability: 'files.use',
    id: 'dashboards.read',
    minimumRole: 'read',
  }),
  create: defineWorkspaceOperation({
    ...policy,
    capability: 'files.use',
    id: 'dashboards.create',
    minimumRole: 'write',
  }),
  update: defineWorkspaceOperation({
    ...policy,
    capability: 'files.use',
    id: 'dashboards.update',
    minimumRole: 'write',
  }),
  move: defineWorkspaceOperation({
    ...policy,
    capability: 'files.use',
    id: 'dashboards.move',
    minimumRole: 'write',
  }),
  delete: defineWorkspaceOperation({
    ...policy,
    capability: 'files.use',
    id: 'dashboards.delete',
    minimumRole: 'write',
  }),
  folders: defineWorkspaceOperation({
    ...policy,
    capability: 'files.use',
    id: 'dashboards.folders.list',
    minimumRole: 'read',
  }),
  createFolder: defineWorkspaceOperation({
    ...policy,
    capability: 'files.use',
    id: 'dashboards.folders.create',
    minimumRole: 'write',
  }),
  moveFolder: defineWorkspaceOperation({
    ...policy,
    capability: 'files.use',
    id: 'dashboards.folders.move',
    minimumRole: 'write',
  }),
  deleteFolder: defineWorkspaceOperation({
    ...policy,
    capability: 'files.use',
    id: 'dashboards.folders.delete',
    minimumRole: 'write',
  }),
} as const
export type DashboardOperation = (typeof dashboardOperations)[keyof typeof dashboardOperations]
