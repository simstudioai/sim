import 'server-only'
import { notFound, permanentRedirect } from 'next/navigation'
import { mapLegacyWorkspaceUrl } from '@/lib/navigation/legacy-redirects'
import { searchParamsQuery } from '@/lib/navigation/paths'
import { readWorkspaceShellOrganizationId } from '@/platform/lib/data/shell-scope'

/**
 * The body of every page that serves a moved workspace URL: the route table's legacy workspace rule
 * (`mapLegacyWorkspaceUrl`, which `resolveProductRedirect` runs for the same path) answers with a
 * permanent redirect to the page in the organization the workspace renders in. A workspace the
 * viewer cannot open, or a path with no new home, is not found, so a private workspace's
 * organization never shows.
 */
export async function redirectLegacyWorkspaceUrl(
  workspaceId: string,
  segments: readonly string[],
  searchParams: Record<string, string | string[] | undefined>
): Promise<never> {
  const target = mapLegacyWorkspaceUrl({
    workspaceId,
    segments,
    query: searchParamsQuery(searchParams),
    organizationId: await readWorkspaceShellOrganizationId(workspaceId),
  })
  if (!target) notFound()
  permanentRedirect(target)
}
