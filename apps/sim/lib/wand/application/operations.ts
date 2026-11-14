import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

export const wandOperations = {
  // permission-group-exempt: an editor assist billed to the workspace; it reads no protected resource the caller cannot already edit.
  generateForWorkflow: defineWorkspaceOperation({
    id: 'wand.generate_for_workflow',
    minimumRole: 'write',
    capability: 'none',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: an editor assist billed to the workspace; it reads no protected resource the caller cannot already see.
  generateInWorkspace: defineWorkspaceOperation({
    id: 'wand.generate_in_workspace',
    minimumRole: 'read',
    capability: 'none',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
} as const
