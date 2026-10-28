'use client'

import { Chip, ChipSelect, toast } from '@sim/emcn'
import type { SearchIntegrationStatus } from '@/lib/api/contracts/knowledge/search-integrations'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import { assistantSearchSourceForProvider } from '@/lib/assistant-actions/providers'
import {
  getCredentialGroupProviderId,
  getCredentialGroupProviderService,
} from '@/lib/credential-groups/providers'
import { AccountPermissionsLink } from '@/app/o/[organizationId]/integrations/account-permissions-link'
import { DisconnectAccountMenu } from '@/app/o/[organizationId]/integrations/disconnect-account-menu'
import { assistantAccountOptions } from '@/app/o/[organizationId]/integrations/utils'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  useConnectOrganizationAccount,
  useEnsureOrganizationAccounts,
  useReconnectPersonalOrganizationAccount,
} from '@/hooks/queries/organization-accounts'

interface AssistantAccountIntegrationsProps {
  organizationId: string
  search: string
  data: OrganizationAccountsSettings
  policies: SearchIntegrationStatus[] | undefined
  admin?: boolean
}

/** Apps without a Search connector use the same personal enrollment and approval controls. */
export function AssistantAccountIntegrations({
  organizationId,
  search,
  data,
  policies,
  admin = false,
}: AssistantAccountIntegrationsProps) {
  const ensure = useEnsureOrganizationAccounts()
  const connect = useConnectOrganizationAccount()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const onError = (error: Error) => toast.error(error.message)
  const group = data.credentialGroup
  const { providers, visible } = assistantAccountOptions(data, search)
  const query = search.trim().toLowerCase()
  const available = providers.filter(
    (provider) =>
      getCredentialGroupProviderService(provider).name.toLowerCase().includes(query) &&
      data.availableProviders.includes(provider) &&
      !group?.options.some((option) => option.provider === provider)
  )
  if (!visible.length && (!admin || !available.length)) return null
  return (
    <SettingsSection
      label='Assistant apps'
      action={
        admin && available.length ? (
          <ChipSelect
            aria-label='Add Assistant app'
            placeholder='Add app'
            value=''
            disabled={ensure.isPending}
            options={available.map((provider) => ({
              value: provider,
              label: getCredentialGroupProviderService(provider).name,
            }))}
            onChange={(value) => {
              const provider = available.find((candidate) => candidate === value)
              if (provider && provider !== 'slack')
                ensure.mutate(
                  {
                    organizationId,
                    option: {
                      provider,
                      label: getCredentialGroupProviderService(provider).name,
                      required: false,
                    },
                  },
                  { onError }
                )
            }}
          />
        ) : undefined
      }
    >
      <p className='mb-3 text-[var(--text-muted)] text-small'>
        Connect your own account to use these apps in Assistant. Write actions ask for review by
        default.
      </p>
      <div className='flex flex-col gap-3'>
        {visible.map((option) => {
          const service = getCredentialGroupProviderService(option.provider)
          const accounts = (data.viewerAccounts ?? []).filter(
            (account) => account.optionId === option.id
          )
          const source = assistantSearchSourceForProvider(
            getCredentialGroupProviderId(option.provider)
          )
          const policy = policies?.find((entry) => entry.connectorType === source)
          const ready =
            group?.status === 'active' &&
            option.status === 'active' &&
            option.configurationStatus === 'ready' &&
            providers.includes(option.provider) &&
            data.availableProviders.includes(option.provider) &&
            (!source || (policy?.approved === true && policy.available !== false))
          return (
            <SettingsResourceRow
              key={option.id}
              iconVariant='custom'
              icon={<IntegrationTile blockType={option.provider} icon={service.icon} />}
              title={service.name}
              description={
                accounts.length
                  ? accounts.map((account) => account.displayName).join(', ')
                  : ready
                    ? 'No account connected'
                    : 'Connections are paused'
              }
              trailing={
                <div className='flex flex-wrap items-center justify-end gap-2'>
                  <AccountPermissionsLink organizationId={organizationId} accounts={accounts} />
                  <DisconnectAccountMenu
                    organizationId={organizationId}
                    integrationName={service.name}
                    accounts={accounts}
                  />
                  {accounts
                    .filter((account) => account.status === 'needs_reauth')
                    .map((account) => (
                      <Chip
                        key={account.credentialId}
                        disabled={!ready || reconnect.isPending}
                        onClick={() => reconnect.mutate(account.credentialId, { onError })}
                      >
                        Reconnect{accounts.length > 1 ? ` ${account.displayName}` : ''}
                      </Chip>
                    ))}
                  <Chip
                    disabled={!ready || connect.isPending}
                    onClick={() =>
                      connect.mutate({ organizationId, optionId: option.id }, { onError })
                    }
                  >
                    {accounts.length ? 'Add account' : 'Connect'}
                  </Chip>
                </div>
              }
            />
          )
        })}
      </div>
    </SettingsSection>
  )
}
