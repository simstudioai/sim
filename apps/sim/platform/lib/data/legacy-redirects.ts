import 'server-only'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { mapLegacyWorkspaceUrl } from '@/lib/navigation/legacy-redirects'
import { readWorkspaceShellOrganizationId } from '@/platform/lib/data/shell-scope'

type PageSearchParams = Record<string, string | string[] | undefined>

/**
 * The body of every page that serves a moved workspace URL. Authorizes the viewer's access to the
 * workspace, then answers with a permanent redirect to the page in the organization the workspace
 * renders in (`readWorkspaceShellOrganizationId`: its own, or the viewer's for an
 * organization-less one), or a 404 for a workspace the viewer cannot open, so a private
 * workspace's organization never shows.
 */
export async function redirectLegacyWorkspaceUrl(
  workspaceId: string,
  segments: readonly string[],
  searchParams: PageSearchParams
): Promise<never> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item)
  }

  const session = await getSession()
  if (!session?.user?.id) {
    const path = ['', 'workspace', workspaceId, ...segments].map(encodeURIComponent).join('/')
    const search = query.toString()
    const callbackUrl = search ? `${path}?${search}` : path
    redirect(`/login?${new URLSearchParams({ callbackUrl })}`)
  }

  const target = mapLegacyWorkspaceUrl({
    workspaceId,
    segments,
    query,
    organizationId: await readWorkspaceShellOrganizationId(workspaceId),
  })
  if (!target) notFound()
  permanentRedirect(target)
}
