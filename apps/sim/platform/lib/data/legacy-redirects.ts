import 'server-only'
import { notFound, permanentRedirect } from 'next/navigation'
import { mapLegacyWorkspaceUrl } from '@/lib/navigation/legacy-redirects'
import { decodePathSegments, searchParamsQuery } from '@/lib/navigation/paths'
import { readWorkspaceShellOrganizationId } from '@/platform/lib/data/shell-scope'

/**
 * The body of every page that serves a moved workspace URL: the route table's legacy workspace rule
 * (`mapLegacyWorkspaceUrl`, which `resolveProductRedirect` runs for the same path) answers with a
 * permanent redirect to the page in the organization the workspace renders in. A workspace the
 * viewer cannot open, or a path with no new home, is not found, so a private workspace's
 * organization never shows. The page passes its route params as Next hands them, still
 * percent-encoded; they are decoded once here, and the route builders encode them once.
 */
export async function redirectLegacyWorkspaceUrl(
  encodedWorkspaceId: string,
  encodedSegments: readonly string[],
  searchParams: Record<string, string | string[] | undefined>
): Promise<never> {
  const decoded = decodePathSegments([encodedWorkspaceId, ...encodedSegments])
  if (!decoded) notFound()
  const [workspaceId, ...segments] = decoded
  const target = mapLegacyWorkspaceUrl({
    workspaceId,
    segments,
    query: searchParamsQuery(searchParams),
    organizationId: await readWorkspaceShellOrganizationId(workspaceId),
  })
  if (!target) notFound()
  permanentRedirect(target)
}
