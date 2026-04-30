import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, ensureDomain, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const jsmSelectors = {
  'jsm.serviceDesks': {
    key: 'jsm.serviceDesks',
    contracts: [selectorContracts.jsmServiceDesksSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'jsm.serviceDesks',
      context.oauthCredential ?? 'none',
      context.domain ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.domain),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'jsm.serviceDesks')
      const domain = ensureDomain(context, 'jsm.serviceDesks')
      const data = await requestJson(selectorContracts.jsmServiceDesksSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          domain,
        },
        signal,
      })
      return (data.serviceDesks || []).map((sd) => ({
        id: sd.id,
        label: sd.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'jsm.serviceDesks')
      const domain = ensureDomain(context, 'jsm.serviceDesks')
      const data = await requestJson(selectorContracts.jsmServiceDesksSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          domain,
        },
        signal,
      })
      const sd = (data.serviceDesks || []).find((s) => s.id === detailId) ?? null
      if (!sd) return null
      return { id: sd.id, label: sd.name }
    },
  },
  'jsm.requestTypes': {
    key: 'jsm.requestTypes',
    contracts: [selectorContracts.jsmRequestTypesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'jsm.requestTypes',
      context.oauthCredential ?? 'none',
      context.domain ?? 'none',
      context.serviceDeskId ?? 'none',
    ],
    enabled: ({ context }) =>
      Boolean(context.oauthCredential && context.domain && context.serviceDeskId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'jsm.requestTypes')
      const domain = ensureDomain(context, 'jsm.requestTypes')
      if (!context.serviceDeskId) throw new Error('Missing serviceDeskId for jsm.requestTypes')
      const data = await requestJson(selectorContracts.jsmRequestTypesSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          domain,
          serviceDeskId: context.serviceDeskId,
        },
        signal,
      })
      return (data.requestTypes || []).map((rt) => ({
        id: rt.id,
        label: rt.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'jsm.requestTypes')
      const domain = ensureDomain(context, 'jsm.requestTypes')
      if (!context.serviceDeskId) return null
      const data = await requestJson(selectorContracts.jsmRequestTypesSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          domain,
          serviceDeskId: context.serviceDeskId,
        },
        signal,
      })
      const rt = (data.requestTypes || []).find((r) => r.id === detailId) ?? null
      if (!rt) return null
      return { id: rt.id, label: rt.name }
    },
  },
} satisfies Record<
  Extract<SelectorKey, 'jsm.serviceDesks' | 'jsm.requestTypes'>,
  SelectorDefinition
>
