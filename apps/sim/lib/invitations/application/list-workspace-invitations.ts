import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { listInvitationsForWorkspaces } from '@/lib/invitations/core'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

/** permission-group-exempt: administrators can inspect and revoke outstanding grants when sending is withheld. */
export const listWorkspaceInvitationsOperation = defineWorkspaceOperation({
  id: 'workspace_invitations.list',
  minimumRole: 'admin',
  capability: 'none',
  workspaceApiKey: 'deny',
  principalKinds: ['session', 'delegated'],
  delegatedServices: ['copilot'],
})

export const listWorkspaceInvitations = defineAuthorizedWorkspaceUseCase({
  operation: listWorkspaceInvitationsOperation,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: { audience: 'sim:settings', isWithinScope: () => true } },
  execute: async ({ context }) => {
    const rows = await listInvitationsForWorkspaces([context.workspaceId])
    // Explicit projection: invitation tokens and future private columns never reach tool output.
    return {
      invitations: rows
        .filter((row) => row.workspaceId === context.workspaceId && row.status === 'pending')
        .map((row) => ({
          id: row.id,
          workspaceId: row.workspaceId,
          email: row.email,
          permission: row.permission,
          membershipIntent: row.membershipIntent,
          status: row.status,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
        })),
    }
  },
})
