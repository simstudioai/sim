'use client'

import { useMemo } from 'react'
import type {
  ColumnDefinition,
  TableDefinition,
  TableRow,
  WorkflowGroup,
} from '@/lib/table'
import type { FlattenOutputsBlockInput } from '@/lib/workflows/blocks/flatten-outputs'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { useTable as useTableQuery, useTableRows } from '@/hooks/queries/tables'
import { useWorkflows, useWorkflowStates } from '@/hooks/queries/workflows'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { getBlock } from '@/blocks'
import type {
  BlockIconInfo,
  ColumnSourceInfo,
} from '../components/table/types'
import type { QueryOptions } from '../types'

const EMPTY_COLUMNS: ColumnDefinition[] = []
const EMPTY_GROUPS: WorkflowGroup[] = []

interface UseTableParams {
  workspaceId: string
  tableId: string
  queryOptions: QueryOptions
}

export interface UseTableReturn {
  /** Table definition (name, schema, metadata, etc.). */
  tableData: TableDefinition | undefined
  isLoadingTable: boolean
  /** Cached page of rows for the active filter/sort. */
  rows: TableRow[]
  isLoadingRows: boolean
  refetchRows: () => void
  /** Workspace-wide workflow metadata used by header chips and the column sidebar. */
  workflows: WorkflowMetadata[] | undefined
  /** Stable reference to `tableData?.schema?.columns ?? []`. */
  columns: ColumnDefinition[]
  /** Stable reference to `tableData?.schema?.workflowGroups ?? []`. */
  tableWorkflowGroups: WorkflowGroup[]
  /** Pre-fetched live state for every unique workflow id used by the table. */
  workflowStates: Map<string, WorkflowState | null>
  /** Pre-resolved icon + block-name info per output column name. Headers read
   *  from this map instead of each subscribing to its own workflow-state query. */
  columnSourceInfo: Map<string, ColumnSourceInfo>
  /** `workflowId → workflow.name` lookup for cell labels and execution-detail copy. */
  workflowNameById: Record<string, string>
}

/**
 * Coordinator hook for the table view's data layer. Wraps row/schema/workflow
 * fetching and exposes the derived collections every consumer needs (display
 * columns, source-info map, workflow-name lookup). Mirrors the shape of
 * `use-chat`'s coordinator: one hook returning a typed bundle the surface
 * component destructures.
 *
 * Local interaction state (drag, resize, selection, editing) stays in the
 * `Table` component — moving that here would push every keystroke through a
 * single hook return and re-render the world.
 */
export function useTable({ workspaceId, tableId, queryOptions }: UseTableParams): UseTableReturn {
  const { data: tableData, isLoading: isLoadingTable } = useTableQuery(workspaceId, tableId)

  const {
    data: rowsData,
    isLoading: isLoadingRows,
    refetch: refetchRows,
  } = useTableRows({
    workspaceId,
    tableId,
    limit: 1000,
    offset: 0,
    filter: queryOptions.filter,
    sort: queryOptions.sort,
    includeTotal: false,
    enabled: Boolean(workspaceId && tableId),
  })
  const rows = (rowsData?.rows ?? []) as TableRow[]

  const { data: workflows } = useWorkflows(workspaceId)

  const columns = useMemo(
    () => tableData?.schema?.columns || EMPTY_COLUMNS,
    [tableData?.schema?.columns]
  )

  const tableWorkflowGroups = useMemo<WorkflowGroup[]>(
    () => tableData?.schema?.workflowGroups ?? EMPTY_GROUPS,
    [tableData?.schema?.workflowGroups]
  )

  const workflowStates = useWorkflowStates(
    useMemo(() => tableWorkflowGroups.map((g) => g.workflowId), [tableWorkflowGroups])
  )

  const columnSourceInfo = useMemo<Map<string, ColumnSourceInfo>>(() => {
    const map = new Map<string, ColumnSourceInfo>()
    for (const group of tableWorkflowGroups) {
      const state = workflowStates.get(group.workflowId)
      const blocks = (state as { blocks?: Record<string, FlattenOutputsBlockInput> } | null)
        ?.blocks
      for (const out of group.outputs) {
        const block = blocks?.[out.blockId]
        const blockConfig = block?.type ? getBlock(block.type) : undefined
        const blockIconInfo: BlockIconInfo | undefined = blockConfig?.icon
          ? { icon: blockConfig.icon, color: blockConfig.bgColor || '#2F55FF' }
          : undefined
        const blockName = block?.name?.trim() || undefined
        map.set(out.columnName, { blockIconInfo, blockName })
      }
    }
    return map
  }, [tableWorkflowGroups, workflowStates])

  const workflowNameById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const wf of workflows ?? []) {
      map[wf.id] = wf.name
    }
    return map
  }, [workflows])

  return {
    tableData,
    isLoadingTable,
    rows,
    isLoadingRows,
    refetchRows,
    workflows,
    columns,
    tableWorkflowGroups,
    workflowStates,
    columnSourceInfo,
    workflowNameById,
  }
}
