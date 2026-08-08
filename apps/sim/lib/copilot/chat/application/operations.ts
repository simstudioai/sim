import { defineWorkspaceOperation } from '@/lib/core/application'

const PERSONAL_API_KEY_PRINCIPALS = ['personal_api_key'] as const

export const chatOperations = {
  listRuns: defineWorkspaceOperation({
    id: 'chat.runs.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: PERSONAL_API_KEY_PRINCIPALS,
  }),
  readRun: defineWorkspaceOperation({
    id: 'chat.runs.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: PERSONAL_API_KEY_PRINCIPALS,
  }),
} as const
