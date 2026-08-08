import { defineWorkspaceOperation } from '@/lib/core/application'

const ALL_PRINCIPAL_KINDS = [
  'session',
  'personal_api_key',
  'workspace_api_key',
  'delegated',
] as const
const HUMAN_PRINCIPAL_KINDS = ['session', 'personal_api_key', 'delegated'] as const

export const skillOperations = {
  list: defineWorkspaceOperation({
    id: 'skills.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  listAvailable: defineWorkspaceOperation({
    id: 'skills.list_available',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: HUMAN_PRINCIPAL_KINDS,
  }),
  read: defineWorkspaceOperation({
    id: 'skills.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  create: defineWorkspaceOperation({
    id: 'skills.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  update: defineWorkspaceOperation({
    id: 'skills.update',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: HUMAN_PRINCIPAL_KINDS,
  }),
  delete: defineWorkspaceOperation({
    id: 'skills.delete',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: HUMAN_PRINCIPAL_KINDS,
  }),
} as const

export type SkillOperation = (typeof skillOperations)[keyof typeof skillOperations]
