import { requestJson } from '@/lib/api/client/request'
import {
  type HarmonicSavedSearchesSelectorResponse,
  harmonicSavedSearchesSelectorContract,
} from '@/lib/api/contracts/selectors/harmonic'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type {
  SelectorDefinition,
  SelectorKey,
  SelectorOption,
  SelectorQueryArgs,
} from '@/hooks/selectors/types'

type HarmonicSavedSearch = HarmonicSavedSearchesSelectorResponse['savedSearches'][number]
type HarmonicSelectorKey = Extract<SelectorKey, 'harmonic.savedSearches'>

function scopeSatisfied({ context }: SelectorQueryArgs): boolean {
  return Boolean(context.oauthCredential && context.workflowId)
}

function toOption(savedSearch: HarmonicSavedSearch): SelectorOption {
  return {
    id: savedSearch.urn,
    label: savedSearch.name,
    meta: {
      id: savedSearch.id,
      urn: savedSearch.urn,
      name: savedSearch.name,
    },
  }
}

async function fetchSavedSearches({ context, signal }: SelectorQueryArgs) {
  const credential = ensureCredential(context, 'harmonic.savedSearches')
  if (!context.workflowId) {
    throw new Error('Missing workflow ID for selector harmonic.savedSearches')
  }

  return requestJson(harmonicSavedSearchesSelectorContract, {
    body: { credential, workflowId: context.workflowId },
    signal,
  })
}

export const harmonicSelectors = {
  'harmonic.savedSearches': {
    key: 'harmonic.savedSearches',
    contracts: [harmonicSavedSearchesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'harmonic.savedSearches',
      context.workflowId ?? 'none',
      context.oauthCredential ?? 'none',
    ],
    enabled: scopeSatisfied,
    fetchList: async (args: SelectorQueryArgs) =>
      (await fetchSavedSearches(args)).savedSearches.map(toOption),
    fetchById: async (args: SelectorQueryArgs) => {
      const detailId = args.detailId?.trim()
      if (!detailId || !scopeSatisfied(args)) return null
      const match = (await fetchSavedSearches(args)).savedSearches.find(
        (savedSearch) => savedSearch.urn === detailId || savedSearch.id === detailId
      )
      return match ? toOption(match) : null
    },
    resolvesUnknownIds: true,
  },
} satisfies Record<HarmonicSelectorKey, SelectorDefinition>
