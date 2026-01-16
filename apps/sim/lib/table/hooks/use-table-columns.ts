import { useEffect, useRef, useState } from 'react'
import type { ColumnOption } from '../types'

interface UseTableColumnsOptions {
  tableId: string | null | undefined
  includeBuiltIn?: boolean
}

/** Fetches table schema columns as dropdown options. */
export function useTableColumns({ tableId, includeBuiltIn = false }: UseTableColumnsOptions) {
  const [columns, setColumns] = useState<ColumnOption[]>([])
  const fetchedTableIdRef = useRef<string | null>(null)

  useEffect(() => {
    const fetchColumns = async () => {
      if (!tableId || tableId === fetchedTableIdRef.current) return

      try {
        const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')
        const workspaceId = useWorkflowRegistry.getState().hydration.workspaceId
        if (!workspaceId) return

        const response = await fetch(`/api/table/${tableId}?workspaceId=${workspaceId}`)
        if (!response.ok) return

        const result = await response.json()
        const cols = result.data?.table?.schema?.columns || result.table?.schema?.columns || []
        const schemaCols = cols.map((col: { name: string }) => ({
          value: col.name,
          label: col.name,
        }))

        if (includeBuiltIn) {
          const builtInCols = [
            { value: 'createdAt', label: 'createdAt' },
            { value: 'updatedAt', label: 'updatedAt' },
          ]
          setColumns([...schemaCols, ...builtInCols])
        } else {
          setColumns(schemaCols)
        }

        fetchedTableIdRef.current = tableId
      } catch {
        // Silently fail
      }
    }

    fetchColumns()
  }, [tableId, includeBuiltIn])

  return columns
}
