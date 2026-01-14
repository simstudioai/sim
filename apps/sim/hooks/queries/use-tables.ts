/**
 * React Query hooks for managing user-defined tables.
 *
 * Provides hooks for fetching, creating, and deleting tables within a workspace.
 * Tables are user-defined data structures that can store rows of data in JSONB format.
 *
 * @module hooks/queries/use-tables
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TableDefinition } from '@/tools/table/types'

/**
 * Query key factories for table-related queries.
 * Ensures consistent cache invalidation across the app.
 */
/**
 * Query keys for table-related queries in React Query.
 * Use these keys to ensure correct cache scoping and invalidation
 * in queries or mutations dealing with user-defined tables.
 */
export const tableKeys = {
  /**
   * Base key for all table queries.
   * Example: ['tables']
   */
  all: ['tables'] as const,

  /**
   * Key for all lists of tables.
   * Useful for cache invalidation across all table lists.
   * Example: ['tables', 'list']
   */
  lists: () => [...tableKeys.all, 'list'] as const,

  /**
   * Key for the list of tables in a specific workspace.
   * @param workspaceId - The workspace ID to scope the list to.
   * Example: ['tables', 'list', 'workspace_abc123']
   */
  list: (workspaceId?: string) => [...tableKeys.lists(), workspaceId ?? ''] as const,

  /**
   * Key for all individual table detail queries.
   * Useful for cache invalidation for all details.
   * Example: ['tables', 'detail']
   */
  details: () => [...tableKeys.all, 'detail'] as const,

  /**
   * Key for a specific table's detail.
   * @param tableId - The table ID to scope the detail to.
   * Example: ['tables', 'detail', 'table_abc123']
   */
  detail: (tableId: string) => [...tableKeys.details(), tableId] as const,
}

/**
 * Hook to fetch all tables for a workspace.
 *
 * @param workspaceId - The workspace ID to fetch tables for. If undefined, the query is disabled.
 * @returns React Query result containing the list of tables.
 */
export function useTablesList(workspaceId?: string) {
  return useQuery({
    queryKey: tableKeys.list(workspaceId),
    queryFn: async () => {
      if (!workspaceId) throw new Error('Workspace ID required')

      const res = await fetch(`/api/table?workspaceId=${encodeURIComponent(workspaceId)}`)

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to fetch tables')
      }

      const response = await res.json()
      return (response.data?.tables || []) as TableDefinition[]
    },
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000, // Cache data for 30 seconds before refetching
  })
}

/**
 * Hook to create a new table in a workspace.
 *
 * @param workspaceId - The workspace ID where the table will be created.
 * @returns React Query mutation object with mutationFn and onSuccess handler.
 *          The mutationFn accepts table creation parameters (name, description, schema).
 *          On success, invalidates the tables list query to refresh the UI.
 */
export function useCreateTable(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      name: string
      description?: string
      schema: { columns: Array<{ name: string; type: string; required?: boolean }> }
    }) => {
      const res = await fetch('/api/table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, workspaceId }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to create table')
      }

      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tableKeys.list(workspaceId) })
    },
  })
}

/**
 * Hook to delete a table from a workspace.
 *
 * @param workspaceId - The workspace ID containing the table to delete.
 * @returns React Query mutation object with mutationFn and onSuccess handler.
 *          The mutationFn accepts a tableId string.
 *          On success, invalidates the tables list query to refresh the UI.
 */
export function useDeleteTable(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (tableId: string) => {
      const res = await fetch(
        `/api/table/${tableId}?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: 'DELETE',
        }
      )

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to delete table')
      }

      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tableKeys.list(workspaceId) })
    },
  })
}
