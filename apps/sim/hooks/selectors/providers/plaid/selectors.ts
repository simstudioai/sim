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

type PlaidAccountSelectorKey = Extract<
  SelectorKey,
  'plaid.accounts' | 'plaid.accounts.auth' | 'plaid.accounts.transactions'
>
type PlaidSelectorKey = Extract<SelectorKey, `plaid.${string}`>
type PlaidAccountEligibility = 'all' | 'auth' | 'transactions'

function requirePlaidContext(context: SelectorContext, key: PlaidSelectorKey) {
  if (!context.workspaceId) throw new Error(`Missing workspace ID for ${key} selector`)
  if (!context.oauthCredential) throw new Error(`Missing Plaid credential for ${key} selector`)
  return {
    workspaceId: context.workspaceId,
    credentialId: context.oauthCredential,
  }
}

function createPlaidAccountSelector(
  key: PlaidAccountSelectorKey,
  eligibility: PlaidAccountEligibility
): SelectorDefinition {
  const fetchAccountOptions = async (args: SelectorQueryArgs): Promise<SelectorOption[]> => {
    const scope = requirePlaidContext(args.context, key)
    const data = await requestJson(plaidOptionsContract, {
      body: {
        kind: 'accounts',
        ...scope,
        eligibility,
      },
      signal: args.signal,
    })
    return data.options
  }

  return {
    key,
    contracts: [plaidOptionsContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      key,
      context.workspaceId ?? 'none',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.workspaceId && context.oauthCredential),
    fetchList: fetchAccountOptions,
    fetchById: async (args: SelectorQueryArgs) => {
      if (!args.detailId) return null
      return (await fetchAccountOptions(args)).find((option) => option.id === args.detailId) ?? null
    },
    resolvesUnknownIds: true,
  }
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
  'plaid.accounts': createPlaidAccountSelector('plaid.accounts', 'all'),
  'plaid.accounts.auth': createPlaidAccountSelector('plaid.accounts.auth', 'auth'),
  'plaid.accounts.transactions': createPlaidAccountSelector(
    'plaid.accounts.transactions',
    'transactions'
  ),
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
