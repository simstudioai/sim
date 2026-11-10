import { redirect } from 'next/navigation'
import { searchParamsQuery } from '@/lib/navigation/paths'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { workspaceRootHref } from '@/platform/lib/workspace-navigation'

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

/** A workspace's bare URL opens its home tab; the live shell answers a document load the same way. */
export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  redirect(
    workspaceRootHref(
      workspaceId,
      resolvePlatformMode() === 'live' ? 'live' : 'fixture',
      searchParamsQuery(query)
    )
  )
}
