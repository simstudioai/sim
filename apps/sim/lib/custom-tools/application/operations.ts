import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const ALL_PRINCIPAL_POLICY = {
  principalKinds: [
    'session',
    'personal_api_key',
    'oauth_access_token',
    'workspace_api_key',
    'delegated',
  ],
  delegatedServices: ['copilot'],
} as const
const HUMAN_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
  delegatedServices: ['copilot'],
} as const

/**
 * Every operation declares `custom_tools.use`, reads included. A custom tool is
 * a user-authored function an agent calls; a group that withholds them has no
 * use for the definitions either, and gating only execution would leave the
 * authoring surface open to a member who can never run what it produces.
 */
export const customToolOperations = {
  list: defineWorkspaceOperation({
    id: 'custom_tools.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'custom_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  listAvailable: defineWorkspaceOperation({
    id: 'custom_tools.list_available',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'custom_tools.use',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  read: defineWorkspaceOperation({
    id: 'custom_tools.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'custom_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  readAvailableByIdOrTitle: defineWorkspaceOperation({
    id: 'custom_tools.read_available_by_id_or_title',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'custom_tools.use',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot', 'executor'],
  }),
  create: defineWorkspaceOperation({
    id: 'custom_tools.create',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'custom_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  save: defineWorkspaceOperation({
    id: 'custom_tools.save',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'custom_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  update: defineWorkspaceOperation({
    id: 'custom_tools.update',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'custom_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  updateAvailable: defineWorkspaceOperation({
    id: 'custom_tools.update_available',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'custom_tools.use',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  delete: defineWorkspaceOperation({
    id: 'custom_tools.delete',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'custom_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  deleteAvailable: defineWorkspaceOperation({
    id: 'custom_tools.delete_available',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'custom_tools.use',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
} as const

export type CustomToolOperation = (typeof customToolOperations)[keyof typeof customToolOperations]
