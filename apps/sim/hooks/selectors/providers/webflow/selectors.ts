import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const webflowSelectors = {
  'webflow.sites': {
    key: 'webflow.sites',
    contracts: [selectorContracts.webflowSitesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'webflow.sites',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'webflow.sites')
      const data = await requestJson(selectorContracts.webflowSitesSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.sites || []).map((site) => ({
        id: site.id,
        label: site.name,
      }))
    },
  },
  'webflow.collections': {
    key: 'webflow.collections',
    contracts: [selectorContracts.webflowCollectionsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'webflow.collections',
      context.oauthCredential ?? 'none',
      context.siteId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.siteId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'webflow.collections')
      if (!context.siteId) {
        throw new Error('Missing site ID for webflow.collections selector')
      }
      const data = await requestJson(selectorContracts.webflowCollectionsSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          siteId: context.siteId,
        },
        signal,
      })
      return (data.collections || []).map((collection) => ({
        id: collection.id,
        label: collection.name,
      }))
    },
  },
  'webflow.items': {
    key: 'webflow.items',
    contracts: [selectorContracts.webflowItemsSelectorContract],
    staleTime: 15 * 1000,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'webflow.items',
      context.oauthCredential ?? 'none',
      context.collectionId ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.collectionId),
    fetchList: async ({ context, search, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'webflow.items')
      if (!context.collectionId) {
        throw new Error('Missing collection ID for webflow.items selector')
      }
      const data = await requestJson(selectorContracts.webflowItemsSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          collectionId: context.collectionId,
          search,
        },
        signal,
      })
      return (data.items || []).map((item) => ({
        id: item.id,
        label: item.name,
      }))
    },
  },
} satisfies Record<
  Extract<SelectorKey, 'webflow.sites' | 'webflow.collections' | 'webflow.items'>,
  SelectorDefinition
>
