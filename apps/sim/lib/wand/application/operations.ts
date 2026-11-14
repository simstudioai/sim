import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

export const wandOperations = {
  // permission-group-exempt: an editor assist billed to the workspace; the one protected resource it reads, a table schema, is gated on `tables.use` in the use case.
  generateForWorkflow: defineWorkspaceOperation({
    id: 'wand.generate_for_workflow',
    minimumRole: 'write',
    capability: 'none',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: an editor assist billed to the workspace; the one protected resource it reads, a table schema, is gated on `tables.use` in the use case.
  generateInWorkspace: defineWorkspaceOperation({
    id: 'wand.generate_in_workspace',
    minimumRole: 'read',
    capability: 'none',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
} as const
