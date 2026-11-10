import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveOrganizationLanding } from '@/lib/organizations/surface'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'
import { isOrganizationMember } from '@/lib/workspaces/shell-organization'

const workspaceShellOperations = {
  // permission-group-exempt: names the organization whose navigation frames a workspace the viewer can already read; it discloses only an organization they belong to
  read: defineWorkspaceOperation({
    id: 'workspaces.shell.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
} as const

interface ReadWorkspaceShellInput {
  workspaceId: string
}

export interface WorkspaceShell {
  /**
   * The organization the workspace's pages render in: its own when the viewer is a member of it,
   * otherwise the viewer's landing organization; `null` when the viewer belongs to none yet.
   */
  organizationId: string | null
}

/**
 * Which organization's shell a workspace the viewer can read opens in. A workspace opens in its
 * own organization, personal ones included, for a member of it. Otherwise it opens in the viewer's
 * landing organization: an organization-less workspace (a personal workspace kept outside the team
 * its owner joined), a guest on someone's personal workspace, and an external collaborator on a
 * team's workspace all see it inside their own organization, since an organization's surface is
 * open only to its members. Billing and permissions stay the workspace's own either way.
 *
 * Read-only: a viewer in no organization gets `null`, and the caller decides whether to provision
 * one (`ensureViewerOrganization`). A workspace the viewer cannot read is refused (not found or
 * forbidden; see {@link isWorkspaceShellRefusal}), so its organization never shows.
 */
export const readWorkspaceShell = defineAuthorizedWorkspaceUseCase({
  operation: workspaceShellOperations.read,
  resolveContext: ({ input }: { input: ReadWorkspaceShellInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, context }): Promise<WorkspaceShell> => ({
    organizationId: await resolveWorkspaceShellOrganizationId(
      context.workspaceOrganizationId ?? null,
      principal.userId
    ),
  }),
})

/**
 * The organization whose shell a workspace in `workspaceOrganizationId` renders in for `userId`, as
 * {@link readWorkspaceShell} answers it: its own when they are a member of it, otherwise their
 * landing organization (`null` when they belong to none). Authorizes nothing; callers check the
 * viewer's access to the workspace themselves.
 */
export async function resolveWorkspaceShellOrganizationId(
  workspaceOrganizationId: string | null,
  userId: string
): Promise<string | null> {
  if (workspaceOrganizationId && (await isOrganizationMember(workspaceOrganizationId, userId)))
    return workspaceOrganizationId
  return resolveOrganizationLanding(userId, null)
}

/** A refusal of {@link readWorkspaceShell}: the viewer cannot open the workspace, or it is gone. */
export function isWorkspaceShellRefusal(error: unknown): boolean {
  return (
    error instanceof OrchestrationError &&
    (error.code === 'not_found' || error.code === 'forbidden')
  )
}
