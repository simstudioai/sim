import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import {
  parseShellScope,
  SHELL_PATH_HEADER,
  SHELL_SCOPE_HEADER,
} from '@/lib/navigation/shell-scope'
import { resolveOrProvisionLandingOrganization } from '@/lib/organizations/provision-personal'
import { resolveWorkspaceShellOrganizationId } from '@/lib/workspaces/shell-organization'
import { readSessionViewer } from '@/platform/lib/data/server-read'

/**
 * The organization the viewer's shell opens in when no URL names one: where they land, or, for an
 * account not yet in any organization (before the backfill reaches it, or after a failed signup
 * provisioning), the personal organization provisioned for them now. Provisioning creates the
 * organization and its owner membership only; their workspaces stay where they are.
 */
const readViewerLandingOrganizationId = cache(
  async (userId: string): Promise<string | null> => resolveOrProvisionLandingOrganization(userId)
)

/**
 * The organization whose shell a workspace the viewer can open renders in, or `null` when they
 * cannot (or are signed out): its own when they are a member of it, else their landing one
 * (`resolveWorkspaceShellOrganizationId`).
 */
export const readWorkspaceShellOrganizationId = cache(
  async (workspaceId: string): Promise<string | null> => {
    const viewer = await readSessionViewer()
    if (!viewer) return null
    return resolveWorkspaceShellOrganizationId(
      workspaceId,
      viewer.principal.userId,
      readViewerLandingOrganizationId
    )
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
  return (
    workspaceOrganizationId ??
    (await readViewerLandingOrganizationId(viewer.principal.userId)) ??
    undefined
  )
})

/** The path this document request opens, as the proxy names it; `null` outside the proxy. */
export async function readShellPath(): Promise<string | null> {
  return (await headers()).get(SHELL_PATH_HEADER)
}
