import { defineWorkspaceOperation } from '@/lib/core/application'

const ALL_PRINCIPAL_KINDS = [
  'session',
  'personal_api_key',
  'workspace_api_key',
  'delegated',
] as const

export const mcpServerOperations = {
  list: defineWorkspaceOperation({
    id: 'mcp_servers.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  read: defineWorkspaceOperation({
    id: 'mcp_servers.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  create: defineWorkspaceOperation({
    id: 'mcp_servers.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  register: defineWorkspaceOperation({
    id: 'mcp_servers.register',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  update: defineWorkspaceOperation({
    id: 'mcp_servers.update',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  reconfigure: defineWorkspaceOperation({
    id: 'mcp_servers.reconfigure',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  delete: defineWorkspaceOperation({
    id: 'mcp_servers.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
} as const

export type McpServerOperation = (typeof mcpServerOperations)[keyof typeof mcpServerOperations]
