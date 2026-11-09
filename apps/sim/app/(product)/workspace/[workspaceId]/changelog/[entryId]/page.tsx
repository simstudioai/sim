import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ChangelogDetails } from '@/app/(product)/workspace/[workspaceId]/changelog/_components/changelog-details/changelog-details'
import { loadWorkspaceChangelogEntry } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { platformHref, readScenario } from '@/platform/lib/navigation'
import type { ProductPageProps } from '@/platform/lib/route-props'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { withChangelogView } from '@/platform/lib/workspace-views'

export const metadata: Metadata = { title: 'Changelog' }

/** The mode is per-request; a build must not freeze the answer. */
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
  if (resolvePlatformMode() === 'live') {
    const [{ readWorkspaceTabFlag }, { LiveRelease }] = await Promise.all([
      import('@/platform/lib/data/workspace-tab-flags'),
      import(
        '@/app/(product)/workspace/[workspaceId]/changelog/_components/live-release/live-release'
      ),
    ])
    if (!(await readWorkspaceTabFlag('changelog'))) notFound()
    return <LiveRelease workspaceId={workspaceId} releaseId={id} back={back} />
  }
  const entry = await loadWorkspaceChangelogEntry(readScenario(query.state), workspaceId, id)
  if (!entry) notFound()
  return <ChangelogDetails entry={entry} back={back} />
}
