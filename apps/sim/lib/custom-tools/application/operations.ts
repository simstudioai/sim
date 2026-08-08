import { defineWorkspaceOperation } from '@/lib/core/application'

const ALL_PRINCIPAL_KINDS = [
  'session',
  'personal_api_key',
  'workspace_api_key',
  'delegated',
] as const
const HUMAN_PRINCIPAL_KINDS = ['session', 'personal_api_key', 'delegated'] as const

export const customToolOperations = {
  list: defineWorkspaceOperation({
    id: 'custom_tools.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  listAvailable: defineWorkspaceOperation({
    id: 'custom_tools.list_available',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: HUMAN_PRINCIPAL_KINDS,
  }),
  read: defineWorkspaceOperation({
    id: 'custom_tools.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  create: defineWorkspaceOperation({
    id: 'custom_tools.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  save: defineWorkspaceOperation({
    id: 'custom_tools.save',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  update: defineWorkspaceOperation({
    id: 'custom_tools.update',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  updateAvailable: defineWorkspaceOperation({
    id: 'custom_tools.update_available',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: HUMAN_PRINCIPAL_KINDS,
  }),
  delete: defineWorkspaceOperation({
    id: 'custom_tools.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  deleteAvailable: defineWorkspaceOperation({
    id: 'custom_tools.delete_available',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: HUMAN_PRINCIPAL_KINDS,
  }),
} as const

export type CustomToolOperation = (typeof customToolOperations)[keyof typeof customToolOperations]
