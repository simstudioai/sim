import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { ChangelogDetails } from '@/app/(product)/workspace/[workspaceId]/changelog/_components/changelog-details/changelog-details'
import { platformHref, readScenario } from '@/platform/lib/navigation'
import type { ProductPageProps } from '@/platform/lib/route-props'
import { withChangelogView } from '@/platform/lib/workspace-views'

export const metadata: Metadata = { title: 'Changelog' }

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
  searchParams,
}: ProductPageProps<{ workspaceId: string; entryId: string }>) {
  const [{ workspaceId, entryId }, query] = await Promise.all([params, searchParams])
  const search = { get: (key: string) => (typeof query[key] === 'string' ? query[key] : null) }
  const back = {
    href: withChangelogView(platformHref(workspacePath(workspaceId, 'changelog'), search), query),
    label: 'Changelog',
  }
  const id = decodeURIComponent(entryId)
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const { loadWorkspaceChangelogEntry } = await import('@/platform/fixtures')
    const entry = await loadWorkspaceChangelogEntry(readScenario(query.state), workspaceId, id)
    if (!entry) notFound()
    return <ChangelogDetails entry={entry} back={back} />
  }
  const [{ readWorkspaceTabFlag }, { LiveRelease }] = await Promise.all([
    import('@/platform/lib/data/workspace-tab-flags'),
    import(
      '@/app/(product)/workspace/[workspaceId]/changelog/_components/live-release/live-release'
    ),
  ])
  if (!(await readWorkspaceTabFlag('changelog'))) notFound()
  return <LiveRelease workspaceId={workspaceId} releaseId={id} back={back} />
}
