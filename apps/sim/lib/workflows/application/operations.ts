import { defineWorkspaceOperation } from '@/lib/core/application'

const ALL_WORKFLOW_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const

const WORKFLOW_READ_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot', 'executor'],
} as const

const HUMAN_WORKFLOW_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const

const COPILOT_WORKFLOW_PRINCIPAL_POLICY = {
  principalKinds: ['delegated'],
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
    ...WORKFLOW_READ_PRINCIPAL_POLICY,
  }),
  readDeploymentOverview: defineWorkspaceOperation({
    id: 'workflows.deployment_overview.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  readCopilotRunOptions: defineWorkspaceOperation({
    id: 'workflows.copilot.run_options.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  readCopilotBlockOutputs: defineWorkspaceOperation({
    id: 'workflows.copilot.block_outputs.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  readCopilotUpstreamReferences: defineWorkspaceOperation({
    id: 'workflows.copilot.upstream_references.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
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
  updatePolicy: defineWorkspaceOperation({
    id: 'workflows.policy.update',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  applyVariableOperations: defineWorkspaceOperation({
    id: 'workflows.variables.apply_operations',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  setBlockEnabled: defineWorkspaceOperation({
    id: 'workflows.blocks.set_enabled',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  moveBulk: defineWorkspaceOperation({
    id: 'workflows.bulk.move',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  createVfsFolders: defineWorkspaceOperation({
    id: 'workflows.vfs.folders.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  moveVfsItems: defineWorkspaceOperation({
    id: 'workflows.vfs.move',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  copyVfsItems: defineWorkspaceOperation({
    id: 'workflows.vfs.copy',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  deleteVfsItems: defineWorkspaceOperation({
    id: 'workflows.vfs.delete',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  duplicate: defineWorkspaceOperation({
    id: 'workflows.duplicate',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  runFromCopilot: defineWorkspaceOperation({
    id: 'workflows.copilot.run',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  runUntilFromCopilot: defineWorkspaceOperation({
    id: 'workflows.copilot.run_until',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  runFromBlockFromCopilot: defineWorkspaceOperation({
    id: 'workflows.copilot.run_from_block',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  runBlockFromCopilot: defineWorkspaceOperation({
    id: 'workflows.copilot.run_block',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
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
  deployChat: defineWorkspaceOperation({
    id: 'workflows.chat.deploy',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...HUMAN_WORKFLOW_PRINCIPAL_POLICY,
  }),
  undeployChat: defineWorkspaceOperation({
    id: 'workflows.chat.undeploy',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...HUMAN_WORKFLOW_PRINCIPAL_POLICY,
  }),
  updatePublicApi: defineWorkspaceOperation({
    id: 'workflows.public_api.update',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  activateVersion: defineWorkspaceOperation({
    id: 'workflows.versions.activate',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...HUMAN_WORKFLOW_PRINCIPAL_POLICY,
  }),
  revertVersion: defineWorkspaceOperation({
    id: 'workflows.versions.revert',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...HUMAN_WORKFLOW_PRINCIPAL_POLICY,
  }),
  updateVersion: defineWorkspaceOperation({
    id: 'workflows.versions.update',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
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
  compareReferences: defineWorkspaceOperation({
    id: 'workflows.versions.compare_references',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
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
