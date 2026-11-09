import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'Table' }

/** The mode is per-request; a build with no API origin must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string; tableId: string }>
}) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId, tableId }, { TableRoute }] = await Promise.all([
    params,
    import(
      '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/table-route/table-route'
    ),
  ])
  return <TableRoute workspaceId={workspaceId} tableId={tableId} />
}
