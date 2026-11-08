import { EmptyState } from '@sim/emcn/empty-state'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ChangelogRoute } from '@/platform/app/(shell)/workspace/[workspaceId]/changelog/_components/changelog-route/changelog-route'
import { loadWorkspaceChangelog } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { readScenario } from '@/platform/lib/navigation'

export const metadata: Metadata = { title: 'Changelog' }

export default async function Page({
  params,
  searchParams,
}: PageProps<'/workspace/[workspaceId]/changelog'>) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  const mode = resolvePlatformMode()
  if (mode === 'live') {
    const { redirectWorkspaceTabToLegacy } = await import('@/platform/lib/data/workspace-directory')
    redirectWorkspaceTabToLegacy(workspaceId, 'changelog', undefined, query)
  }
  const data = await loadWorkspaceChangelog(readScenario(query.state), workspaceId)
  if (!data) {
    if (mode === 'fixture') notFound()
    return <EmptyState title='Changelog' description='No workspace data available.' />
  }
  return <ChangelogRoute data={data} />
}
