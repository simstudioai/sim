import { defineWorkspaceOperation } from '@/lib/core/application'

const ALL_WORKFLOW_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const

const HUMAN_WORKFLOW_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const

export const workflowOperations = {
  list: defineWorkspaceOperation({
    id: 'workflows.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  read: defineWorkspaceOperation({
    id: 'workflows.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  create: defineWorkspaceOperation({
    id: 'workflows.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  update: defineWorkspaceOperation({
    id: 'workflows.update',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  delete: defineWorkspaceOperation({
    id: 'workflows.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  listFolders: defineWorkspaceOperation({
    id: 'workflows.folders.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  createFolder: defineWorkspaceOperation({
    id: 'workflows.folders.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  relocateFolder: defineWorkspaceOperation({
    id: 'workflows.folders.relocate',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  deleteFolder: defineWorkspaceOperation({
    id: 'workflows.folders.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  deploy: defineWorkspaceOperation({
    id: 'workflows.deploy',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...HUMAN_WORKFLOW_PRINCIPAL_POLICY,
  }),
  undeploy: defineWorkspaceOperation({
    id: 'workflows.undeploy',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...HUMAN_WORKFLOW_PRINCIPAL_POLICY,
  }),
  activateVersion: defineWorkspaceOperation({
    id: 'workflows.versions.activate',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...HUMAN_WORKFLOW_PRINCIPAL_POLICY,
  }),
  listVersions: defineWorkspaceOperation({
    id: 'workflows.versions.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  readVersion: defineWorkspaceOperation({
    id: 'workflows.versions.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  export: defineWorkspaceOperation({
    id: 'workflows.export',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  import: defineWorkspaceOperation({
    id: 'workflows.import',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  execute: defineWorkspaceOperation({
    id: 'workflows.execute',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  listRuns: defineWorkspaceOperation({
    id: 'workflows.runs.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  readRun: defineWorkspaceOperation({
    id: 'workflows.runs.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  cancelRun: defineWorkspaceOperation({
    id: 'workflows.runs.cancel',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  resumeRun: defineWorkspaceOperation({
    id: 'workflows.runs.resume',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
} as const

export type WorkflowOperation = (typeof workflowOperations)[keyof typeof workflowOperations]
