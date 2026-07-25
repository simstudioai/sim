import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import TableLoading from '@/app/workspace/[workspaceId]/tables/[tableId]/loading'
import { Table } from './table'

export const metadata: Metadata = {
  title: 'Table',
}

/**
 * Table-detail page entry. `Table` reads URL query params via nuqs (which uses
 * `useSearchParams` internally), so it must sit under a Suspense boundary. The
 * fallback renders the real chrome so a suspend never shows a blank frame.
 *
 * The lock flag is resolved here rather than mirrored into a `NEXT_PUBLIC_` var:
 * gating lives in AppConfig, which has no client counterpart, so resolving it
 * server-side is the only way its org/user clauses reach the UI. `getSession`
 * is request-cached, so this reuses the layout's read.
 */
export default async function TablePage() {
  const session = await getSession()
  const tableLocksEnabled = await isFeatureEnabled('table-locks', {
    userId: session?.user?.id,
    orgId: getActiveOrganizationId(session) ?? undefined,
  })

  return (
    <Suspense fallback={<TableLoading />}>
      <Table tableLocksEnabled={tableLocksEnabled} />
    </Suspense>
  )
}
