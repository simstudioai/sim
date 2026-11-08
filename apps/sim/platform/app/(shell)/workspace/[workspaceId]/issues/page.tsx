import { EmptyState } from '@sim/emcn/empty-state'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IssuesRoute } from '@/platform/app/(shell)/workspace/[workspaceId]/issues/_components/issues-route/issues-route'
import { loadWorkspaceIssues } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { readScenario } from '@/platform/lib/navigation'

export const metadata: Metadata = { title: 'Issues' }

export default async function Page({
  params,
  searchParams,
}: PageProps<'/workspace/[workspaceId]/issues'>) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  const mode = resolvePlatformMode()
  // Issues have no backend yet, so live workspaces neither list nor link them.
  if (mode === 'live') notFound()
  const data = await loadWorkspaceIssues(readScenario(query.state), workspaceId)
  if (!data) {
    if (mode === 'fixture') notFound()
    return <EmptyState title='Issues' description='No workspace data available.' />
  }
  return <IssuesRoute data={data} />
}
