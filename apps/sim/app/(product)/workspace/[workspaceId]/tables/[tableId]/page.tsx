import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'Table' }

/** The mode is per-request; a build must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string; tableId: string }>
}) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId, tableId }, { TableRoute }, { AccessBoundary }] = await Promise.all([
    params,
    import(
      '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/table-route/table-route'
    ),
    import('@/app/(product)/workspace/[workspaceId]/_components/access-required/access-boundary'),
  ])
  return (
    <AccessBoundary workspaceId={workspaceId} gate='hideTablesTab' current='tables' layout='canvas'>
      <TableRoute workspaceId={workspaceId} tableId={tableId} />
    </AccessBoundary>
  )
}
