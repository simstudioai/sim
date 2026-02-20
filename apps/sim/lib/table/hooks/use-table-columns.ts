import { useMemo } from 'react'
import { useTable } from '@/hooks/queries/tables'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { ColumnOption } from '../types'

interface UseTableColumnsOptions {
  tableId: string | null | undefined
  includeBuiltIn?: boolean
}

/** Fetches table schema columns as dropdown options. */
export function useTableColumns({ tableId, includeBuiltIn = false }: UseTableColumnsOptions) {
  const workspaceId = useWorkflowRegistry((state) => state.hydration.workspaceId)
  const { data: tableData } = useTable(workspaceId ?? undefined, tableId ?? undefined)

  const schemaColumns = useMemo<ColumnOption[]>(
    () =>
      (tableData?.schema?.columns || []).map((col) => ({
        value: col.name,
        label: col.name,
      })),
    [tableData]
  )

  return useMemo(() => {
    if (includeBuiltIn) {
      const builtInCols = [
        { value: 'createdAt', label: 'createdAt' },
        { value: 'updatedAt', label: 'updatedAt' },
      ]
      return [...schemaColumns, ...builtInCols]
    }

    return schemaColumns
  }, [includeBuiltIn, schemaColumns])
}
