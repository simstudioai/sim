import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { isWorkspaceTabShown } from '@/platform/lib/workspace-navigation'

export const metadata: Metadata = { title: 'Tests' }

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId }, { readWorkspaceTabFlags }, { TestList }] = await Promise.all([
    params,
    import('@/platform/lib/data/workspace-tab-flags'),
    import('@/app/(product)/workspace/[workspaceId]/tests/_components/test-list/test-list'),
  ])
  // A tab live data does not list has no page.
  if (!isWorkspaceTabShown('tests', await readWorkspaceTabFlags())) notFound()
  return <TestList workspaceId={workspaceId} />
}
