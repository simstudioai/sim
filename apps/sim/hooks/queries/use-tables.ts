/**
 * React Query hooks for managing user-defined tables.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TableDefinition } from '@/lib/table'

export const tableKeys = {
  all: ['tables'] as const,
  lists: () => [...tableKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...tableKeys.lists(), workspaceId ?? ''] as const,
  details: () => [...tableKeys.all, 'detail'] as const,
  detail: (tableId: string) => [...tableKeys.details(), tableId] as const,
}

/**
 * Fetch all tables for a workspace.
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
    staleTime: 30 * 1000,
  })
}

/**
 * Create a new table in a workspace.
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
 * Delete a table from a workspace.
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
