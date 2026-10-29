import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import { getCredentialGroupProviderService } from '@/lib/credential-groups/providers'
import {
  LIVE_SEARCH_SOURCE_TYPES,
  liveSearchMemberAccountProvider,
} from '@/lib/sim-search/live/source-catalog'

const SEARCH_ACCOUNT_PROVIDERS = new Set([
  'slack',
  ...LIVE_SEARCH_SOURCE_TYPES.flatMap(([source]) => {
    const provider = liveSearchMemberAccountProvider(source)
    return provider ? [provider] : []
  }),
])

export function assistantAccountOptions(data: OrganizationAccountsSettings, search: string) {
  const providers = data.assistantProviders.filter(
    (provider) => !SEARCH_ACCOUNT_PROVIDERS.has(provider)
  )
  const ownedOptions = new Set(data.viewerAccounts?.map((account) => account.optionId))
  const configured =
    data.credentialGroup?.options.filter(
      (option) =>
        !SEARCH_ACCOUNT_PROVIDERS.has(option.provider) &&
        ((option.status === 'active' && providers.includes(option.provider)) ||
          ownedOptions.has(option.id))
    ) ?? []
  const query = search.trim().toLowerCase()
  const visible = configured.filter((option) =>
    [
      getCredentialGroupProviderService(option.provider).name,
      ...(data.viewerAccounts ?? [])
        .filter((account) => account.optionId === option.id)
        .map((account) => account.displayName),
    ]
      .join(' ')
      .toLowerCase()
      .includes(query)
  )
  return { providers, configured, visible }
}
