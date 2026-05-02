import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { getFolderMap } from '@/hooks/queries/utils/folder-cache'
import { getFolderPath } from '@/hooks/queries/utils/folder-tree'
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
import type { WorkflowFolder } from '@/stores/folders/types'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

/**
 * Builds a label for a workflow option, appending the folder path when another
 * workflow in the workspace shares the same display name. Avoids suffixing
 * every workflow so the dropdown stays readable for the common case.
 */
function buildDisambiguatedLabel(
  workflow: WorkflowMetadata,
  duplicateNames: Set<string>,
  folders: Record<string, WorkflowFolder>
): string {
  const baseLabel = workflow.name || `Workflow ${workflow.id.slice(0, 8)}`
  if (!duplicateNames.has(baseLabel)) return baseLabel

  const folderPath = getFolderPath(workflow.folderId, folders)
  return folderPath ? `${baseLabel} (${folderPath})` : `${baseLabel} (Root)`
}

function collectDuplicateNames(workflows: WorkflowMetadata[]): Set<string> {
  const counts = new Map<string, number>()
  for (const workflow of workflows) {
    const label = workflow.name || `Workflow ${workflow.id.slice(0, 8)}`
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const duplicates = new Set<string>()
  for (const [label, count] of counts) {
    if (count > 1) duplicates.add(label)
  }
  return duplicates
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
      const duplicateNames = collectDuplicateNames(workflows)
      return workflows
        .filter((w) => w.id !== context.excludeWorkflowId)
        .map((w) => ({
          id: w.id,
          label: buildDisambiguatedLabel(w, duplicateNames, folders),
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
      const duplicateNames = collectDuplicateNames(workflows)
      return {
        id: detailId,
        label: buildDisambiguatedLabel(workflow, duplicateNames, folders),
      }
    },
  },
} satisfies Record<Extract<SelectorKey, 'sim.workflows'>, SelectorDefinition>
