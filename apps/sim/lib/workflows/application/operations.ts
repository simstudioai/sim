import { defineWorkspaceOperation } from '@/lib/core/application'

const ALL_WORKFLOW_PRINCIPALS = [
  'session',
  'personal_api_key',
  'workspace_api_key',
  'delegated',
] as const

const HUMAN_WORKFLOW_PRINCIPALS = ['session', 'personal_api_key', 'delegated'] as const

export const workflowOperations = {
  list: defineWorkspaceOperation({
    id: 'workflows.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  read: defineWorkspaceOperation({
    id: 'workflows.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  create: defineWorkspaceOperation({
    id: 'workflows.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  update: defineWorkspaceOperation({
    id: 'workflows.update',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  delete: defineWorkspaceOperation({
    id: 'workflows.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  listFolders: defineWorkspaceOperation({
    id: 'workflows.folders.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  createFolder: defineWorkspaceOperation({
    id: 'workflows.folders.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  relocateFolder: defineWorkspaceOperation({
    id: 'workflows.folders.relocate',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  deleteFolder: defineWorkspaceOperation({
    id: 'workflows.folders.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  deploy: defineWorkspaceOperation({
    id: 'workflows.deploy',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: HUMAN_WORKFLOW_PRINCIPALS,
  }),
  undeploy: defineWorkspaceOperation({
    id: 'workflows.undeploy',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: HUMAN_WORKFLOW_PRINCIPALS,
  }),
  activateVersion: defineWorkspaceOperation({
    id: 'workflows.versions.activate',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: HUMAN_WORKFLOW_PRINCIPALS,
  }),
  listVersions: defineWorkspaceOperation({
    id: 'workflows.versions.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  readVersion: defineWorkspaceOperation({
    id: 'workflows.versions.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  export: defineWorkspaceOperation({
    id: 'workflows.export',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  import: defineWorkspaceOperation({
    id: 'workflows.import',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  execute: defineWorkspaceOperation({
    id: 'workflows.execute',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  listRuns: defineWorkspaceOperation({
    id: 'workflows.runs.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  readRun: defineWorkspaceOperation({
    id: 'workflows.runs.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  cancelRun: defineWorkspaceOperation({
    id: 'workflows.runs.cancel',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
  resumeRun: defineWorkspaceOperation({
    id: 'workflows.runs.resume',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_WORKFLOW_PRINCIPALS,
  }),
} as const

export type WorkflowOperation = (typeof workflowOperations)[keyof typeof workflowOperations]
