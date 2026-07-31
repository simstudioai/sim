import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import TableLoading from '@/app/workspace/[workspaceId]/tables/[tableId]/loading'
import { Table } from './table'

export const metadata: Metadata = {
  title: 'Table',
}

interface TablePageProps {
  params: Promise<{ workspaceId: string }>
}

/**
 * Table-detail page entry. `Table` reads URL query params via nuqs (which uses
 * `useSearchParams` internally), so it must sit under a Suspense boundary. The
 * fallback renders the real chrome so a suspend never shows a blank frame.
 *
 * Both flags are resolved here rather than mirrored into `NEXT_PUBLIC_` vars:
 * gating lives in AppConfig, which has no client counterpart, so resolving them
 * server-side is the only way their org/user clauses reach the UI. The org is the
 * workspace's host organization, not the viewer's active one — the same key the
 * write gates use, so a panel can't open onto a Save that 403s. `getSession` and
 * the host context are request-memoized, so this reuses the layout's reads and
 * the two flag lookups share them.
 */
export default async function TablePage({ params }: TablePageProps) {
  const [{ workspaceId }, session] = await Promise.all([params, getSession()])
  const userId = session?.user?.id
  const host = userId ? await getWorkspaceHostContextForViewer(workspaceId, userId) : null
  const orgId = host?.hostOrganizationId ?? undefined
  const [tableLocksEnabled, viewsEnabled] = await Promise.all([
    isFeatureEnabled('table-locks', { userId, orgId }),
    isFeatureEnabled('table-views', { userId, orgId }),
  ])

  return (
    <Suspense fallback={<TableLoading />}>
      <Table tableLocksEnabled={tableLocksEnabled} viewsEnabled={viewsEnabled} />
    </Suspense>
  )
}
