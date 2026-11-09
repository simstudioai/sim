import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { readScenario } from '@/platform/lib/navigation'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Issues' }

export default async function Page({
  params,
  searchParams,
}: ProductPageProps<{ workspaceId: string }>) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const [{ IssuesRoute }, { loadWorkspaceIssues }] = await Promise.all([
      import(
        '@/app/(product)/workspace/[workspaceId]/issues/_components/issues-route/issues-route'
      ),
      import('@/platform/fixtures'),
    ])
    const data = await loadWorkspaceIssues(readScenario(query.state), workspaceId)
    if (data) return <IssuesRoute data={data} />
  }
  // Issues have no backend yet, so live workspaces neither list nor link them.
  notFound()
}
