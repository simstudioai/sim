import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import {
  findCredentialGroupProviderFromProviderId,
  getCredentialGroupProviderService,
} from '@/lib/credential-groups/providers'
import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'

export function assistantAccountOptions(data: OrganizationAccountsSettings, search: string) {
  const providers = data.assistantProviders.filter(
    (provider) =>
      provider !== 'slack' &&
      !SEARCH_CONNECTORS.some(
        (connector) => findCredentialGroupProviderFromProviderId(connector.providerId) === provider
      )
  )
  const ownedOptions = new Set(data.viewerAccounts?.map((account) => account.optionId))
  const configured =
    data.credentialGroup?.options.filter(
      (option) =>
        !SEARCH_CONNECTORS.some(
          (connector) =>
            findCredentialGroupProviderFromProviderId(connector.providerId) === option.provider
        ) &&
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
