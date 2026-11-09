import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ChangelogDetails } from '@/platform/app/(shell)/workspace/[workspaceId]/changelog/_components/changelog-details/changelog-details'
import { loadWorkspaceChangelogEntry } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { platformHref, readScenario } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { withChangelogView } from '@/platform/lib/workspace-views'

export const metadata: Metadata = { title: 'Changelog' }

/** The mode is per-request; a build with no API origin must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
  searchParams,
}: PageProps<'/workspace/[workspaceId]/changelog/[entryId]'>) {
  const [{ workspaceId, entryId }, query] = await Promise.all([params, searchParams])
  const search = { get: (key: string) => (typeof query[key] === 'string' ? query[key] : null) }
  const back = {
    href: withChangelogView(platformHref(workspacePath(workspaceId, 'changelog'), search), query),
    label: 'Changelog',
  }
  const id = decodeURIComponent(entryId)
  if (resolvePlatformMode() === 'live') {
    const { LiveRelease } = await import(
      '@/platform/app/(shell)/workspace/[workspaceId]/changelog/_components/live-release/live-release'
    )
    return <LiveRelease workspaceId={workspaceId} releaseId={id} back={back} />
  }
  const entry = await loadWorkspaceChangelogEntry(readScenario(query.state), workspaceId, id)
  if (!entry) notFound()
  return <ChangelogDetails entry={entry} back={back} />
}
