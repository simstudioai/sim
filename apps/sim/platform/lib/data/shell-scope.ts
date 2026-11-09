import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { parseShellScope, SHELL_SCOPE_HEADER } from '@/lib/navigation/shell-scope'
import { resolveWorkspaceShellOrganizationId } from '@/lib/workspaces/shell-organization'
import { readSessionViewer } from '@/platform/lib/data/server-read'

/**
 * The organization whose shell a workspace the viewer can open renders in, or `null` when they
 * cannot (or are signed out): its own, or the viewer's for an organization-less workspace
 * (`resolveWorkspaceShellOrganizationId`).
 */
export const readWorkspaceShellOrganizationId = cache(
  async (workspaceId: string): Promise<string | null> => {
    const viewer = await readSessionViewer()
    if (!viewer) return null
    return resolveWorkspaceShellOrganizationId(workspaceId, viewer.principal.userId)
  }
)

/**
 * The organization this request's shell belongs to: the one an `/o/<id>` URL names, or the one a
 * `/workspace/<id>` URL's workspace renders in. `undefined` outside both, and for a workspace the
 * viewer cannot open, which leaves the shell in their landing organization while the workspace
 * layout answers not found.
 */
export const readShellOrganizationId = cache(async (): Promise<string | undefined> => {
  const scope = parseShellScope((await headers()).get(SHELL_SCOPE_HEADER))
  if (!scope) return undefined
  if (scope.kind === 'organization') return scope.organizationId
  return (await readWorkspaceShellOrganizationId(scope.workspaceId)) ?? undefined
})
