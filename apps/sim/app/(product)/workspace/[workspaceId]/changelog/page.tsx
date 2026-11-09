import { EmptyState } from '@sim/emcn/empty-state'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ChangelogRoute } from '@/app/(product)/workspace/[workspaceId]/changelog/_components/changelog-route/changelog-route'
import { loadWorkspaceChangelog } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { readScenario } from '@/platform/lib/navigation'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Changelog' }

/** The mode is per-request; a build must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
  searchParams,
}: ProductPageProps<{ workspaceId: string }>) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  const mode = resolvePlatformMode()
  if (mode === 'live') {
    const [{ readWorkspaceTabFlag }, { LiveChangelog }] = await Promise.all([
      import('@/platform/lib/data/workspace-tab-flags'),
      import(
        '@/app/(product)/workspace/[workspaceId]/changelog/_components/live-changelog/live-changelog'
      ),
    ])
    if (!(await readWorkspaceTabFlag('changelog'))) notFound()
    return <LiveChangelog workspaceId={workspaceId} />
  }
  const data = await loadWorkspaceChangelog(readScenario(query.state), workspaceId)
  if (!data) {
    if (mode === 'fixture') notFound()
    return <EmptyState title='Changelog' description='No workspace data available.' />
  }
  return <ChangelogRoute data={data} />
}
