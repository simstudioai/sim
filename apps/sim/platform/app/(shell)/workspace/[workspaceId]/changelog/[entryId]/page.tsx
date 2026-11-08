import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ChangelogDetails } from '@/platform/app/(shell)/workspace/[workspaceId]/changelog/_components/changelog-details/changelog-details'
import { loadWorkspaceChangelogEntry } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { platformHref, readScenario } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { withChangelogView } from '@/platform/lib/workspace-views'

export const metadata: Metadata = { title: 'Changelog' }

export default async function Page({
  params,
  searchParams,
}: PageProps<'/workspace/[workspaceId]/changelog/[entryId]'>) {
  const [{ workspaceId, entryId }, query] = await Promise.all([params, searchParams])
  if (resolvePlatformMode() === 'live') {
    const { redirectWorkspaceTabToLegacy } = await import('@/platform/lib/data/workspace-directory')
    redirectWorkspaceTabToLegacy(workspaceId, 'changelog', entryId, query)
  }
  const entry = await loadWorkspaceChangelogEntry(
    readScenario(query.state),
    workspaceId,
    decodeURIComponent(entryId)
  )
  if (!entry) notFound()
  const search = { get: (key: string) => (typeof query[key] === 'string' ? query[key] : null) }
  const back = {
    href: withChangelogView(platformHref(workspacePath(workspaceId, 'changelog'), search), query),
    label: 'Changelog',
  }
  return <ChangelogDetails entry={entry} back={back} />
}
