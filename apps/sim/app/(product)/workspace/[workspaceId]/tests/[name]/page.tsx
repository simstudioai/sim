import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { isWorkspaceTabShown } from '@/platform/lib/workspace-navigation'

export const metadata: Metadata = { title: 'Test' }

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string; name: string }>
}) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId, name }, { readWorkspaceTabFlags }, { TestDetails }] = await Promise.all([
    params,
    import('@/platform/lib/data/workspace-tab-flags'),
    import('@/app/(product)/workspace/[workspaceId]/tests/_components/test-details/test-details'),
  ])
  // A tab live data does not list has no page.
  if (!isWorkspaceTabShown('tests', await readWorkspaceTabFlags())) notFound()
  return <TestDetails key={name} workspaceId={workspaceId} name={decodeURIComponent(name)} />
}
