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
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      ...selectorKeys.all,
      'table.columns',
      context.workspaceId ?? 'none',
      context.tableId ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.workspaceId && context.tableId),
    fetchList: async ({ context }: SelectorQueryArgs): Promise<SelectorOption[]> => {
      if (!context.workspaceId || !context.tableId) return []
      const table = await getQueryClient().ensureQueryData(
        getTableDetailQueryOptions(context.workspaceId, context.tableId)
      )
      return (table.schema?.columns ?? [])
        .filter((col) => col.unique)
        .map((col) => ({ id: getColumnId(col), label: col.name }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs): Promise<SelectorOption | null> => {
      if (!detailId || !context.workspaceId || !context.tableId) return null
      const table = await getQueryClient().ensureQueryData(
        getTableDetailQueryOptions(context.workspaceId, context.tableId)
      )
      const col = (table.schema?.columns ?? []).find((c) => getColumnId(c) === detailId)
      return col ? { id: getColumnId(col), label: col.name } : null
    },
  },
} satisfies Record<Extract<SelectorKey, 'sim.workflows' | 'table.columns'>, SelectorDefinition>
