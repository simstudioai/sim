import { defineWorkspaceOperation } from '@/lib/core/application'

const ALL_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const
const HUMAN_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const

export const skillOperations = {
  list: defineWorkspaceOperation({
    id: 'skills.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  }),
  listAvailable: defineWorkspaceOperation({
    id: 'skills.list_available',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  read: defineWorkspaceOperation({
    id: 'skills.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  }),
  create: defineWorkspaceOperation({
    id: 'skills.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  }),
  update: defineWorkspaceOperation({
    id: 'skills.update',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  /**
   * One mixed batch of creates and updates applied as a single unit.
   *
   * The declared minimum role is the floor a pure-update batch needs, matching
   * {@link skillOperations.update}: workspace write is not required to edit a
   * skill you are an editor of. A batch that also creates is additionally
   * authorized against {@link skillOperations.create} by the use case, before
   * anything is written — so neither half of the batch is authorized more
   * loosely than it would be on its own.
   */
  upsert: defineWorkspaceOperation({
    id: 'skills.upsert',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  delete: defineWorkspaceOperation({
    id: 'skills.delete',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
} as const

export type SkillOperation = (typeof skillOperations)[keyof typeof skillOperations]
