import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'Tables' }

/** The mode is per-request; a build with no API origin must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId }, { TableList }] = await Promise.all([
    params,
    import(
      '@/platform/app/(shell)/workspace/[workspaceId]/tables/_components/table-list/table-list'
    ),
  ])
  return <TableList workspaceId={workspaceId} />
}
