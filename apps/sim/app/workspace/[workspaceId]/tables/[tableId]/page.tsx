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
 * The lock flag is resolved here rather than mirrored into a `NEXT_PUBLIC_` var:
 * gating lives in AppConfig, which has no client counterpart, so resolving it
 * server-side is the only way its org/user clauses reach the UI. The org is the
 * workspace's host organization, not the viewer's active one — the same key the
 * PATCH gate uses, so the panel can't open onto a Save that 403s. Both
 * `getSession` and the host context are request-memoized, so this reuses the
 * layout's reads.
 */
export default async function TablePage({ params }: TablePageProps) {
  const [{ workspaceId }, session] = await Promise.all([params, getSession()])
  const userId = session?.user?.id
  const host = userId ? await getWorkspaceHostContextForViewer(workspaceId, userId) : null
  const tableLocksEnabled = await isFeatureEnabled('table-locks', {
    userId,
    orgId: host?.hostOrganizationId ?? undefined,
  })

  return (
    <Suspense fallback={<TableLoading />}>
      <Table tableLocksEnabled={tableLocksEnabled} />
    </Suspense>
  )
}
