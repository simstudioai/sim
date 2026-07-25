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
 * The `table-views` flag is resolved here rather than inside `Table` — there is
 * no client-side AppConfig, so the boolean is passed down as a prop.
 */
export default async function TablePage() {
  const session = await getSession()
  const viewsEnabled = await isFeatureEnabled('table-views', {
    userId: session?.user?.id,
    orgId: getActiveOrganizationId(session) ?? undefined,
  })

  return (
    <Suspense fallback={<TableLoading />}>
      <Table viewsEnabled={viewsEnabled} />
    </Suspense>
  )
}
