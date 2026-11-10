import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { parseShellScope, SHELL_SCOPE_HEADER } from '@/lib/navigation/shell-scope'
import { ensureViewerOrganization } from '@/lib/organizations/application/viewer-organization'
import {
  isWorkspaceShellRefusal,
  readWorkspaceShell,
} from '@/lib/workspaces/application/workspace-shell'
import { readSessionViewer } from '@/platform/lib/data/server-read'

/**
 * The organization the viewer lands in, provisioned first for an account not yet in any
 * organization (before the backfill reaches it, or after a failed signup provisioning) by
 * `ensureViewerOrganization`. This is the shell's one provisioning point, run once per request: it
 * creates the organization and its owner membership only, and their workspaces stay where they are.
 * The shell's reads fall back to it when no URL names an organization the viewer can open.
 */
const ensureViewerLandingOrganization = cache(async (): Promise<string | null> => {
  const viewer = await readSessionViewer()
  if (!viewer) return null
  return ensureViewerOrganization.execute({ principal: viewer.principal, input: {} })
})

/**
 * The organization whose shell a workspace the viewer can open renders in, or `null` when they
 * cannot (or are signed out): its own when they are a member of it, else their landing one
 * (`readWorkspaceShell`), provisioned when they belong to none.
 */
export const readWorkspaceShellOrganizationId = cache(
  async (workspaceId: string): Promise<string | null> => {
    const viewer = await readSessionViewer()
    if (!viewer) return null
    try {
      const shell = await readWorkspaceShell.execute({
        principal: viewer.principal,
        input: { workspaceId },
      })
      return shell.organizationId ?? (await ensureViewerLandingOrganization())
    } catch (error) {
      if (isWorkspaceShellRefusal(error)) return null
      throw error
    }
  }
)

/**
 * The organization this request's shell belongs to: the one an `/o/<id>` URL names, the one a
 * `/workspace/<id>` URL's workspace renders in, and otherwise (including a workspace the viewer
 * cannot open, whose layout answers not found) the viewer's landing organization. `undefined` when
 * signed out, or for an account that no longer exists.
 */
export const readShellOrganizationId = cache(async (): Promise<string | undefined> => {
  const scope = parseShellScope((await headers()).get(SHELL_SCOPE_HEADER))
  if (scope?.kind === 'organization') return scope.organizationId
  const viewer = await readSessionViewer()
  if (!viewer) return undefined
  const workspaceOrganizationId =
    scope?.kind === 'workspace' ? await readWorkspaceShellOrganizationId(scope.workspaceId) : null
  return workspaceOrganizationId ?? (await ensureViewerLandingOrganization()) ?? undefined
})
