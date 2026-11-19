import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/**
 * Build notes are a workflow's agent-only scratchpad: only Copilot acting for a person reads or
 * changes them. People never see them; they ask Chat, which reads the notes for them.
 */
const policy = {
  workspaceApiKey: 'deny',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
} as const

export const buildNotesOperations = {
  // permission-group-exempt: which listed workflows have build notes is workflow metadata, governed by workspace role
  list: defineWorkspaceOperation({
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
    delegatedServices: ['copilot'],
    id: 'workflows.build_notes.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    capability: 'none',
    contentDelivery: 'none',
  }),
  status: defineWorkspaceOperation({
    ...policy,
    id: 'workflows.build_notes.status',
    minimumRole: 'read',
    capability: 'copilot.use',
    contentDelivery: 'none',
  }),
  changes: defineWorkspaceOperation({
    ...policy,
    id: 'workflows.build_notes.changes',
    minimumRole: 'read',
    capability: 'copilot.use',
    contentDelivery: 'sourced',
  }),
  create: defineWorkspaceOperation({
    ...policy,
    id: 'workflows.build_notes.create',
    minimumRole: 'write',
    capability: 'copilot.use',
    contentDelivery: 'none',
  }),
  evaluate: defineWorkspaceOperation({
    ...policy,
    id: 'workflows.build_notes.evaluate',
    minimumRole: 'write',
    capability: 'copilot.use',
    contentDelivery: 'sourced',
  }),
  apply: defineWorkspaceOperation({
    ...policy,
    id: 'workflows.build_notes.apply',
    minimumRole: 'write',
    capability: 'copilot.use',
    contentDelivery: 'sourced',
  }),
  rebase: defineWorkspaceOperation({
    ...policy,
    id: 'workflows.build_notes.rebase',
    minimumRole: 'write',
    capability: 'copilot.use',
    contentDelivery: 'none',
  }),
} as const
