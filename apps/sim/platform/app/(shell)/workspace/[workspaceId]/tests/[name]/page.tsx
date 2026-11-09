import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'Test' }

/** The mode is per-request; a build with no API origin must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string; name: string }>
}) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId, name }, { readWorkflowTestsEnabled }, { TestDetails }] = await Promise.all([
    params,
    import('@/platform/lib/data/workflow-tests/flag'),
    import(
      '@/platform/app/(shell)/workspace/[workspaceId]/tests/_components/test-details/test-details'
    ),
  ])
  if (!(await readWorkflowTestsEnabled())) notFound()
  return <TestDetails key={name} workspaceId={workspaceId} name={decodeURIComponent(name)} />
}
