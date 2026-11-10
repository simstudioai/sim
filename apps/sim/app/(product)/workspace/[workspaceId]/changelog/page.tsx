import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { readScenario } from '@/platform/lib/navigation'
import type { ProductPageProps } from '@/platform/lib/route-props'
import { isWorkspaceTabShown } from '@/platform/lib/workspace-navigation'

export const metadata: Metadata = { title: 'Changelog' }

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
  searchParams,
}: ProductPageProps<{ workspaceId: string }>) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const [{ ChangelogRoute }, { loadWorkspaceChangelog }] = await Promise.all([
      import(
        '@/app/(product)/workspace/[workspaceId]/changelog/_components/changelog-route/changelog-route'
      ),
      import('@/platform/fixtures'),
    ])
    const data = await loadWorkspaceChangelog(readScenario(query.state), workspaceId)
    if (!data) notFound()
    return <ChangelogRoute data={data} />
  }
  const [{ readWorkspaceTabFlags }, { LiveChangelog }] = await Promise.all([
    import('@/platform/lib/data/workspace-tab-flags'),
    import(
      '@/app/(product)/workspace/[workspaceId]/changelog/_components/live-changelog/live-changelog'
    ),
  ])
  // A tab live data does not list has no page.
  if (!isWorkspaceTabShown('changelog', await readWorkspaceTabFlags())) notFound()
  return <LiveChangelog workspaceId={workspaceId} />
}
