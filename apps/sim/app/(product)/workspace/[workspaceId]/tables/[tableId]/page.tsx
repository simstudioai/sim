import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'Table' }

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string; tableId: string }>
}) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId, tableId }, { TableRoute }, { AccessBoundary }] = await Promise.all([
    params,
    import('@/app/(product)/_components/workspace/tables/table-route/table-route'),
    import('@/app/(product)/_components/workspace/access-required/access-boundary'),
  ])
  return (
    <AccessBoundary workspaceId={workspaceId} gate='hideTablesTab' current='tables' layout='canvas'>
      <TableRoute workspaceId={workspaceId} tableId={tableId} />
    </AccessBoundary>
  )
}
