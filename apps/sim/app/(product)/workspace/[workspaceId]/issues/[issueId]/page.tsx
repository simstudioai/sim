import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IssueRoute } from '@/app/(product)/workspace/[workspaceId]/issues/_components/issues-route/issues-route'
import { loadWorkspaceIssue } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { platformHref, readScenario } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { withIssueListView } from '@/platform/lib/workspace-views'

export async function generateMetadata({
  params,
}: PageProps<'/workspace/[workspaceId]/issues/[issueId]'>): Promise<Metadata> {
  const { issueId } = await params
  return { title: decodeURIComponent(issueId) }
}

export default async function Page({
  params,
  searchParams,
}: PageProps<'/workspace/[workspaceId]/issues/[issueId]'>) {
  const [{ workspaceId, issueId }, query] = await Promise.all([params, searchParams])
  if (resolvePlatformMode() === 'live') notFound()
  const issue = await loadWorkspaceIssue(
    readScenario(query.state),
    workspaceId,
    decodeURIComponent(issueId)
  )
  if (!issue) notFound()
  const search = { get: (key: string) => (typeof query[key] === 'string' ? query[key] : null) }
  const back = {
    href: withIssueListView(platformHref(workspacePath(workspaceId, 'issues'), search), query),
    label: 'Issues',
  }
  return <IssueRoute issue={issue} back={back} />
}
