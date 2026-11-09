import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { platformHref, readScenario } from '@/platform/lib/navigation'
import type { ProductPageProps } from '@/platform/lib/route-props'
import { withIssueListView } from '@/platform/lib/workspace-views'

export async function generateMetadata({
  params,
}: ProductPageProps<{ workspaceId: string; issueId: string }>): Promise<Metadata> {
  const { issueId } = await params
  return { title: decodeURIComponent(issueId) }
}

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
  searchParams,
}: ProductPageProps<{ workspaceId: string; issueId: string }>) {
  const [{ workspaceId, issueId }, query] = await Promise.all([params, searchParams])
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const [{ IssueRoute }, { loadWorkspaceIssue }] = await Promise.all([
      import(
        '@/app/(product)/workspace/[workspaceId]/issues/_components/issues-route/issues-route'
      ),
      import('@/platform/fixtures'),
    ])
    const issue = await loadWorkspaceIssue(
      readScenario(query.state),
      workspaceId,
      decodeURIComponent(issueId)
    )
    if (issue) {
      const search = { get: (key: string) => (typeof query[key] === 'string' ? query[key] : null) }
      const back = {
        href: withIssueListView(platformHref(workspacePath(workspaceId, 'issues'), search), query),
        label: 'Issues',
      }
      return <IssueRoute issue={issue} back={back} />
    }
  }
  // Issues have no backend yet, so live workspaces neither list nor open them.
  notFound()
}
