import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const pipedriveSelectors = {
  'pipedrive.pipelines': {
    key: 'pipedrive.pipelines',
    contracts: [selectorContracts.pipedrivePipelinesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'pipedrive.pipelines',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'pipedrive.pipelines')
      const data = await requestJson(selectorContracts.pipedrivePipelinesSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.pipelines || []).map((p) => ({
        id: p.id,
        label: p.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'pipedrive.pipelines')
      const data = await requestJson(selectorContracts.pipedrivePipelinesSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      const p = (data.pipelines || []).find((pl) => pl.id === detailId) ?? null
      if (!p) return null
      return { id: p.id, label: p.name }
    },
  },
} satisfies Record<Extract<SelectorKey, 'pipedrive.pipelines'>, SelectorDefinition>
