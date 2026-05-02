import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const sharepointSelectors = {
  'sharepoint.lists': {
    key: 'sharepoint.lists',
    contracts: [selectorContracts.sharepointListsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'sharepoint.lists',
      context.oauthCredential ?? 'none',
      context.siteId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.siteId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'sharepoint.lists')
      if (!context.siteId) throw new Error('Missing site ID for sharepoint.lists selector')
      const data = await requestJson(selectorContracts.sharepointListsSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          siteId: context.siteId,
        },
        signal,
      })
      return (data.lists || []).map((list) => ({ id: list.id, label: list.displayName }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId || !context.siteId) return null
      const credentialId = ensureCredential(context, 'sharepoint.lists')
      const data = await requestJson(selectorContracts.sharepointListsSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          siteId: context.siteId,
        },
        signal,
      })
      const list = (data.lists || []).find((l) => l.id === detailId) ?? null
      if (!list) return null
      return { id: list.id, label: list.displayName }
    },
  },
  'sharepoint.sites': {
    key: 'sharepoint.sites',
    contracts: [selectorContracts.sharepointSitesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'sharepoint.sites',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'sharepoint.sites')
      const data = await requestJson(selectorContracts.sharepointSitesSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
        },
        signal,
      })
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'sharepoint.sites')
      const data = await requestJson(selectorContracts.sharepointSitesSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
        },
        signal,
      })
      const site = (data.files || []).find((f) => f.id === detailId) ?? null
      if (!site) return null
      return { id: site.id, label: site.name }
    },
  },
} satisfies Record<
  Extract<SelectorKey, 'sharepoint.lists' | 'sharepoint.sites'>,
  SelectorDefinition
>
