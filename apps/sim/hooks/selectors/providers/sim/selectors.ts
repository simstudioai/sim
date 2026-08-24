import { getColumnId } from '@/lib/table/column-keys'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { getTableDetailQueryOptions } from '@/hooks/queries/tables'
import { getFolderMap } from '@/hooks/queries/utils/folder-cache'
import { collectDuplicateNames, disambiguateLabelByFolder } from '@/hooks/queries/utils/folder-tree'
import { getWorkflowById, getWorkflows } from '@/hooks/queries/utils/workflow-cache'
import { getWorkflowListQueryOptions } from '@/hooks/queries/utils/workflow-list-query'
import { SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import { selectorKeys } from '@/hooks/selectors/query-keys'
import type {
  SelectorDefinition,
  SelectorKey,
  SelectorOption,
  SelectorQueryArgs,
} from '@/hooks/selectors/types'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

/** Matches the workflow list's own fallback for an unnamed workflow. */
function workflowBaseLabel(workflow: WorkflowMetadata): string {
  return workflow.name || `Workflow ${workflow.id.slice(0, 8)}`
}

/**
 * The table's current columns. `fetchQuery` (not `ensureQueryData`) so a detail
 * entry the column mutations have already invalidated is refetched instead of
 * served as-is — otherwise a column deleted earlier in the session stays
 * pickable until a reload.
 */
async function getTableColumns(context: SelectorQueryArgs['context']) {
  if (!context.workspaceId || !context.tableId) return []
  const table = await getQueryClient().fetchQuery(
    getTableDetailQueryOptions(context.workspaceId, context.tableId)
  )
  return table.schema?.columns ?? []
}

/**
 * `table.columns`/`table.outputColumns` derive their options from the table
 * detail query, which already tracks staleness and invalidation. Caching the
 * selector result on top of that with the shared `SELECTOR_STALE` would bring
 * back the staleness `getTableColumns` exists to avoid: no column mutation
 * invalidates the selector's own key, so a deleted column would stay pickable
 * (and keep its label on the canvas) for up to a minute. Always defer to the
 * inner fetch, which is a cache hit unless the detail was invalidated.
 */
const TABLE_COLUMN_SELECTOR_STALE = 0

export const simSelectors = {
  'sim.workflows': {
    key: 'sim.workflows',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) =>
      context.workspaceId
        ? selectorKeys.simWorkflows(context.workspaceId, context.excludeWorkflowId)
        : [...selectorKeys.all, 'sim.workflows', 'none', context.excludeWorkflowId ?? 'none'],
    enabled: ({ context }) => Boolean(context.workspaceId),
    fetchList: async ({ context, signal }: SelectorQueryArgs): Promise<SelectorOption[]> => {
      if (!context.workspaceId) return []
      await getQueryClient().ensureQueryData(getWorkflowListQueryOptions(context.workspaceId))
      const workflows = getWorkflows(context.workspaceId)
      const folders = getFolderMap(context.workspaceId)
      const duplicateNames = collectDuplicateNames(workflows.map(workflowBaseLabel))
      return workflows
        .filter((w) => w.id !== context.excludeWorkflowId)
        .map((w) => ({
          id: w.id,
          label: disambiguateLabelByFolder(
            workflowBaseLabel(w),
            w.folderId,
            folders,
            duplicateNames
          ),
        }))
        .sort((a, b) => a.label.localeCompare(b.label))
    },
    fetchById: async ({
      context,
      detailId,
      signal,
    }: SelectorQueryArgs): Promise<SelectorOption | null> => {
      if (!detailId || !context.workspaceId) return null
      await getQueryClient().ensureQueryData(getWorkflowListQueryOptions(context.workspaceId))
      const workflow = getWorkflowById(context.workspaceId, detailId)
      if (!workflow) return null
      const workflows = getWorkflows(context.workspaceId)
      const folders = getFolderMap(context.workspaceId)
      const duplicateNames = collectDuplicateNames(workflows.map(workflowBaseLabel))
      return {
        id: detailId,
        label: disambiguateLabelByFolder(
          workflowBaseLabel(workflow),
          workflow.folderId,
          folders,
          duplicateNames
        ),
      }
    },
  },
  'table.columns': {
    key: 'table.columns',
    staleTime: TABLE_COLUMN_SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      ...selectorKeys.all,
      'table.columns',
      context.workspaceId ?? 'none',
      context.tableId ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.workspaceId && context.tableId),
    fetchList: async ({ context }: SelectorQueryArgs): Promise<SelectorOption[]> => {
      const columns = await getTableColumns(context)
      return columns
        .filter((col) => col.unique)
        .map((col) => ({ id: getColumnId(col), label: col.name }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs): Promise<SelectorOption | null> => {
      if (!detailId) return null
      const columns = await getTableColumns(context)
      const col = columns.find((c) => getColumnId(c) === detailId)
      return col ? { id: getColumnId(col), label: col.name } : null
    },
  },
  'table.outputColumns': {
    key: 'table.outputColumns',
    staleTime: TABLE_COLUMN_SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      ...selectorKeys.all,
      'table.outputColumns',
      context.workspaceId ?? 'none',
      context.tableId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.workspaceId && context.tableId),
    fetchList: async ({ context }: SelectorQueryArgs): Promise<SelectorOption[]> => {
      const columns = await getTableColumns(context)
      return columns.map((col) => ({ id: getColumnId(col), label: col.name }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs): Promise<SelectorOption | null> => {
      if (!detailId) return null
      const columns = await getTableColumns(context)
      const col = columns.find((column) => getColumnId(column) === detailId)
      return col ? { id: getColumnId(col), label: col.name } : null
    },
  },
} satisfies Record<
  Extract<SelectorKey, 'sim.workflows' | 'table.columns' | 'table.outputColumns'>,
  SelectorDefinition
>
