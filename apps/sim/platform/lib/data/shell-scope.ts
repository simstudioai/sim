import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { parseShellScope, SHELL_SCOPE_HEADER } from '@/lib/navigation/shell-scope'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { readSessionViewer } from '@/platform/lib/data/server-read'

/**
 * The organization of a workspace the viewer can open, or `null` when they cannot (or are signed
 * out), so a private workspace's organization never shows. The workspace's own organization,
 * personal ones included, not the paying host.
 */
export const readWorkspaceOrganizationId = cache(
  async (workspaceId: string): Promise<string | null> => {
    const viewer = await readSessionViewer()
    if (!viewer) return null
    const access = await checkWorkspaceAccess(workspaceId, viewer.principal.userId)
    return access.hasAccess ? (access.workspace?.organizationId ?? null) : null
  }
)

/**
 * The organization this request's shell belongs to: the one an `/o/<id>` URL names, or the
 * organization of the workspace a `/workspace/<id>` URL opens. `undefined` outside both, and for a
 * workspace the viewer cannot open, which leaves the shell in their landing organization while the
 * workspace layout answers not found.
 */
export const readShellOrganizationId = cache(async (): Promise<string | undefined> => {
  const scope = parseShellScope((await headers()).get(SHELL_SCOPE_HEADER))
  if (!scope) return undefined
  if (scope.kind === 'organization') return scope.organizationId
  return (await readWorkspaceOrganizationId(scope.workspaceId)) ?? undefined
})
