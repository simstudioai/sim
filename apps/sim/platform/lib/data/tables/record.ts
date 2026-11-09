'use client'

import { isApiClientError } from '@/lib/api/client/errors'
import { useTable } from '@/hooks/queries/tables'
import { queryRead } from '@/platform/shared/workspace-records'

/** A table's read for its page. A table that no longer exists reads as missing rather than failed. */
export function useTableRecord(workspaceId: string, tableId: string) {
  const query = useTable(workspaceId, tableId)
  return {
    missing: isApiClientError(query.error) && query.error.status === 404,
    read: queryRead(query, 'This table could not be loaded.'),
  }
}
