'use client'

import { useCallback, useMemo } from 'react'
import type { ColumnDefinition, TableDefinition, TableRow, WorkflowGroup } from '@/lib/table'
import { TABLE_LIMITS } from '@/lib/table/constants'
import type { FlattenOutputsBlockInput } from '@/lib/workflows/blocks/flatten-outputs'
import { getBlock } from '@/blocks'
import { useInfiniteTableRows, useTable as useTableQuery } from '@/hooks/queries/tables'
import { useWorkflowStates, useWorkflows } from '@/hooks/queries/workflows'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import type { BlockIconInfo, ColumnSourceInfo } from '../components/table-grid/types'
import type { QueryOptions } from '../types'

const EMPTY_COLUMNS: ColumnDefinition[] = []
const EMPTY_GROUPS: WorkflowGroup[] = []

interface UseTableParams {
  workspaceId: string
  tableId: string
  queryOptions: QueryOptions
}

interface FetchNextPageResult {
  hasNextPage: boolean
}

export interface UseTableReturn {
  /** Table definition (name, schema, metadata, etc.). */
  tableData: TableDefinition | undefined
  isLoadingTable: boolean
  /** Flattened rows across every fetched page. */
  rows: TableRow[]
  isLoadingRows: boolean
  refetchRows: () => void
  /**
   * Fetch the next page of rows. The resolved value's `hasNextPage` reflects
   * the post-fetch cache state — read from this rather than the parent's
   * `hasNextPage` state, which only updates on the next React render.
   */
  fetchNextPage: () => Promise<FetchNextPageResult>
  hasNextPage: boolean
  isFetchingNextPage: boolean
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
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteTableRows({
    workspaceId,
    tableId,
    pageSize: TABLE_LIMITS.MAX_QUERY_LIMIT,
    filter: queryOptions.filter,
    sort: queryOptions.sort,
    enabled: Boolean(workspaceId && tableId),
  })

  const rows = useMemo<TableRow[]>(
    () => rowsData?.pages.flatMap((p) => p.rows) ?? [],
    [rowsData?.pages]
  )

  const refetchRows = useCallback(() => {
    void refetch()
  }, [refetch])

  const fetchNextPageWrapped = useCallback(async () => {
    const result = await fetchNextPage()
    if (result.status === 'error') {
      throw result.error ?? new Error('Failed to fetch next page')
    }
    return { hasNextPage: Boolean(result.hasNextPage) }
  }, [fetchNextPage])

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
      const blocks = (state as { blocks?: Record<string, FlattenOutputsBlockInput> } | null)?.blocks
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

  return {
    tableData,
    isLoadingTable,
    rows,
    isLoadingRows,
    refetchRows,
    fetchNextPage: fetchNextPageWrapped,
    hasNextPage: Boolean(hasNextPage),
    isFetchingNextPage,
    workflows,
    columns,
    tableWorkflowGroups,
    workflowStates,
    columnSourceInfo,
  }
}
