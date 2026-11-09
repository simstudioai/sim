import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'Tests' }

/** The mode is per-request; a build with no API origin must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId }, { readWorkspaceTabFlag }, { TestList }] = await Promise.all([
    params,
    import('@/platform/lib/data/workspace-tab-flags'),
    import('@/platform/app/(shell)/workspace/[workspaceId]/tests/_components/test-list/test-list'),
  ])
  if (!(await readWorkspaceTabFlag('workflow-tests'))) notFound()
  return <TestList workspaceId={workspaceId} />
}
