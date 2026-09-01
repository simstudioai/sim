import { defineWorkspaceOperation } from '@/lib/core/application'

const ALL_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const
const HUMAN_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const

export const customToolOperations = {
  list: defineWorkspaceOperation({
    id: 'custom_tools.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  }),
  listAvailable: defineWorkspaceOperation({
    id: 'custom_tools.list_available',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  read: defineWorkspaceOperation({
    id: 'custom_tools.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  }),
  readAvailableByIdOrTitle: defineWorkspaceOperation({
    id: 'custom_tools.read_available_by_id_or_title',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
    workflowExecution: 'allow',
  }),
  create: defineWorkspaceOperation({
    id: 'custom_tools.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  }),
  save: defineWorkspaceOperation({
    id: 'custom_tools.save',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  }),
  update: defineWorkspaceOperation({
    id: 'custom_tools.update',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  }),
  updateAvailable: defineWorkspaceOperation({
    id: 'custom_tools.update_available',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  delete: defineWorkspaceOperation({
    id: 'custom_tools.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  }),
  deleteAvailable: defineWorkspaceOperation({
    id: 'custom_tools.delete_available',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
} as const

export type CustomToolOperation = (typeof customToolOperations)[keyof typeof customToolOperations]
