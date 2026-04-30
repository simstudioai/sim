import { getQueryClient } from '@/app/_shell/providers/get-query-client'
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
      return workflows
        .filter((w) => w.id !== context.excludeWorkflowId)
        .map((w) => ({
          id: w.id,
          label: w.name || `Workflow ${w.id.slice(0, 8)}`,
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
      return {
        id: detailId,
        label: workflow.name || `Workflow ${detailId.slice(0, 8)}`,
      }
    },
  },
} satisfies Record<Extract<SelectorKey, 'sim.workflows'>, SelectorDefinition>
