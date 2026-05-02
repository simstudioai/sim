import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const attioSelectors = {
  'attio.objects': {
    key: 'attio.objects',
    contracts: [selectorContracts.attioObjectsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'attio.objects',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'attio.objects')
      const data = await requestJson(selectorContracts.attioObjectsSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.objects || []).map((obj) => ({
        id: obj.id,
        label: obj.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'attio.objects')
      const data = await requestJson(selectorContracts.attioObjectsSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      const obj = (data.objects || []).find((o) => o.id === detailId) ?? null
      if (!obj) return null
      return { id: obj.id, label: obj.name }
    },
  },
  'attio.lists': {
    key: 'attio.lists',
    contracts: [selectorContracts.attioListsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'attio.lists',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'attio.lists')
      const data = await requestJson(selectorContracts.attioListsSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.lists || []).map((list) => ({
        id: list.id,
        label: list.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'attio.lists')
      const data = await requestJson(selectorContracts.attioListsSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      const list = (data.lists || []).find((l) => l.id === detailId) ?? null
      if (!list) return null
      return { id: list.id, label: list.name }
    },
  },
} satisfies Record<Extract<SelectorKey, 'attio.objects' | 'attio.lists'>, SelectorDefinition>
