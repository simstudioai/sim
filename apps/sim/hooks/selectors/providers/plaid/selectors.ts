import { requestJson } from '@/lib/api/client/request'
import { plaidOptionsContract } from '@/lib/api/contracts/selectors/plaid'
import { SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type {
  SelectorContext,
  SelectorDefinition,
  SelectorKey,
  SelectorOption,
  SelectorQueryArgs,
} from '@/hooks/selectors/types'
import { parsePlaidCountryCodes } from '@/tools/plaid/utils'

type PlaidSelectorKey = Extract<SelectorKey, 'plaid.accounts' | 'plaid.institutions'>

function requirePlaidContext(context: SelectorContext, key: PlaidSelectorKey) {
  if (!context.workspaceId) throw new Error(`Missing workspace ID for ${key} selector`)
  if (!context.oauthCredential) throw new Error(`Missing Plaid credential for ${key} selector`)
  return {
    workspaceId: context.workspaceId,
    credentialId: context.oauthCredential,
  }
}

function plaidAccountEligibility(operation: string | undefined): 'all' | 'auth' | 'transactions' {
  if (operation === 'get_auth') return 'auth'
  if (operation === 'sync_transactions') return 'transactions'
  return 'all'
}

async function fetchAccountOptions(args: SelectorQueryArgs): Promise<SelectorOption[]> {
  const scope = requirePlaidContext(args.context, 'plaid.accounts')
  const data = await requestJson(plaidOptionsContract, {
    body: {
      kind: 'accounts',
      ...scope,
      eligibility: plaidAccountEligibility(args.context.operation),
    },
    signal: args.signal,
  })
  return data.options
}

function plaidCountryQueryKey(value: string | undefined): string {
  const normalized = value
    ?.split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean)
    .join(',')
  return normalized || 'US'
}

export const plaidSelectors = {
  'plaid.accounts': {
    key: 'plaid.accounts',
    contracts: [plaidOptionsContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'plaid.accounts',
      context.workspaceId ?? 'none',
      context.oauthCredential ?? 'none',
      plaidAccountEligibility(context.operation),
    ],
    enabled: ({ context }) => Boolean(context.workspaceId && context.oauthCredential),
    fetchList: fetchAccountOptions,
    fetchById: async (args: SelectorQueryArgs) => {
      if (!args.detailId) return null
      return (await fetchAccountOptions(args)).find((option) => option.id === args.detailId) ?? null
    },
    resolvesUnknownIds: true,
  },
  'plaid.institutions': {
    key: 'plaid.institutions',
    contracts: [plaidOptionsContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search, detailId }: SelectorQueryArgs) => [
      'selectors',
      'plaid.institutions',
      context.workspaceId ?? 'none',
      context.oauthCredential ?? 'none',
      plaidCountryQueryKey(context.countryCodes),
      search ?? 'none',
      detailId ?? 'none',
    ],
    enabled: ({ context, search, detailId }) =>
      Boolean(
        context.workspaceId && context.oauthCredential && (search?.trim() || detailId?.trim())
      ),
    fetchList: async ({ context, search, signal }: SelectorQueryArgs) => {
      const scope = requirePlaidContext(context, 'plaid.institutions')
      const query = search?.trim()
      if (!query) return []
      const data = await requestJson(plaidOptionsContract, {
        body: {
          kind: 'institution_search',
          ...scope,
          query,
          country_codes: parsePlaidCountryCodes(context.countryCodes),
        },
        signal,
      })
      return data.options
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      const scope = requirePlaidContext(context, 'plaid.institutions')
      if (!detailId?.trim()) return null
      const data = await requestJson(plaidOptionsContract, {
        body: {
          kind: 'institution_detail',
          ...scope,
          institution_id: detailId.trim(),
          country_codes: parsePlaidCountryCodes(context.countryCodes),
        },
        signal,
      })
      return data.options[0] ?? null
    },
  },
} satisfies Record<PlaidSelectorKey, SelectorDefinition>
