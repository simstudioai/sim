import { Suspense } from 'react'
import type { Metadata } from 'next'
import TableLoading from '@/app/workspace/[workspaceId]/tables/[tableId]/loading'
import { Table } from './table'

export const metadata: Metadata = {
  title: 'Table',
}

/**
 * Table-detail page entry. `Table` reads URL query params via nuqs (which uses
 * `useSearchParams` internally), so it must sit under a Suspense boundary. The
 * fallback renders the real chrome so a suspend never shows a blank frame.
 */
export default function TablePage() {
  return (
    <Suspense fallback={<TableLoading />}>
      <Table />
    </Suspense>
  )
}
