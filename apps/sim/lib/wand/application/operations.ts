import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

export const wandOperations = {
  /** Generating for a workflow's editor requires write access to the workflow's workspace. */
  // permission-group-exempt: an editor assist billed to the workspace; it reads no protected resource the caller cannot already edit.
  generateForWorkflow: defineWorkspaceOperation({
    id: 'wand.generate_for_workflow',
    minimumRole: 'write',
    capability: 'none',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  /** Generating with no workflow to resolve requires workspace membership. */
  // permission-group-exempt: an editor assist billed to the workspace; it reads no protected resource the caller cannot already see.
  generateInWorkspace: defineWorkspaceOperation({
    id: 'wand.generate_in_workspace',
    minimumRole: 'read',
    capability: 'none',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
} as const
