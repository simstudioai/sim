import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const calcomSelectors = {
  'calcom.eventTypes': {
    key: 'calcom.eventTypes',
    contracts: [selectorContracts.calcomEventTypesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'calcom.eventTypes',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'calcom.eventTypes')
      const data = await requestJson(selectorContracts.calcomEventTypesSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.eventTypes || []).map((et) => ({
        id: et.id,
        label: et.title || et.slug,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'calcom.eventTypes')
      const data = await requestJson(selectorContracts.calcomEventTypesSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      const et = (data.eventTypes || []).find((e) => e.id === detailId) ?? null
      if (!et) return null
      return { id: et.id, label: et.title || et.slug }
    },
  },
  'calcom.schedules': {
    key: 'calcom.schedules',
    contracts: [selectorContracts.calcomSchedulesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'calcom.schedules',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'calcom.schedules')
      const data = await requestJson(selectorContracts.calcomSchedulesSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.schedules || []).map((s) => ({
        id: s.id,
        label: s.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'calcom.schedules')
      const data = await requestJson(selectorContracts.calcomSchedulesSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      const s = (data.schedules || []).find((sc) => sc.id === detailId) ?? null
      if (!s) return null
      return { id: s.id, label: s.name }
    },
  },
} satisfies Record<
  Extract<SelectorKey, 'calcom.eventTypes' | 'calcom.schedules'>,
  SelectorDefinition
>
