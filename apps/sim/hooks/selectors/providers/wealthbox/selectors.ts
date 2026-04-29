import * as selectorContracts from '@/lib/api/contracts/selectors'
import { requestSelectorContract } from '@/hooks/selectors/helpers'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const wealthboxSelectors = {
  'wealthbox.contacts': {
    key: 'wealthbox.contacts',
    contracts: [selectorContracts.wealthboxItemsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'wealthbox.contacts',
      context.oauthCredential ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, search, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'wealthbox.contacts')
      const data = await requestSelectorContract(selectorContracts.wealthboxItemsSelectorContract, {
        query: { credentialId, type: 'contact', query: search ?? '' },
        signal,
      })
      return (data.items || []).map((item) => ({
        id: item.id,
        label: item.name,
      }))
    },
  },
} satisfies Record<Extract<SelectorKey, 'wealthbox.contacts'>, SelectorDefinition>
