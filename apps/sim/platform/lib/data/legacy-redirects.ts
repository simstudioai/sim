import 'server-only'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { mapLegacyWorkspaceUrl } from '@/lib/navigation/legacy-redirects'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'

type PageSearchParams = Record<string, string | string[] | undefined>

/**
 * The body of every page that serves a moved workspace URL. Authorizes the viewer as the workspace
 * layout does, then answers with a permanent redirect, or a 404 for a workspace the viewer cannot
 * open, so a private workspace's organization never shows.
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

  const host = await getWorkspaceHostContextForViewer(workspaceId, session.user.id)
  const target = mapLegacyWorkspaceUrl({
    workspaceId,
    segments,
    query,
    organizationId: host?.hostOrganizationId ?? null,
  })
  if (!target) notFound()
  permanentRedirect(target)
}
