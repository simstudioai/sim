'use client'

import { ChipSelect, toast } from '@sim/emcn'
import type { SearchIntegrationStatus } from '@/lib/api/contracts/knowledge/search-integrations'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import { assistantSearchSourceForProvider } from '@/lib/assistant-actions/providers'
import {
  getCredentialGroupProviderId,
  getCredentialGroupProviderService,
} from '@/lib/credential-groups/providers'
import { AccountActionsMenu } from '@/app/o/[organizationId]/integrations/account-actions-menu'
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
  const connect = useConnectOrganizationAccount()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const ensure = useEnsureOrganizationAccounts()
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
                  : source && !policies
                    ? undefined
                    : ready
                      ? 'No account connected'
                      : 'Connections unavailable'
              }
              trailing={
                <AccountActionsMenu
                  organizationId={organizationId}
                  integrationName={service.name}
                  accounts={accounts}
                  onConnect={
                    accounts.length === 0
                      ? () => connect.mutate({ organizationId, optionId: option.id }, { onError })
                      : undefined
                  }
                  onReconnect={(credentialId) => reconnect.mutate(credentialId, { onError })}
                  connectionPending={connect.isPending || reconnect.isPending}
                  connecting={
                    connect.isPending &&
                    'optionId' in connect.variables &&
                    connect.variables.optionId === option.id
                  }
                  connectionReady={ready}
                  reconnectAccountIds={ready ? accounts.map((account) => account.credentialId) : []}
                  permissionAccountIds={
                    data.assistantProviders.includes(option.provider)
                      ? accounts.map((account) => account.credentialId)
                      : []
                  }
                />
              }
            />
          )
        })}
      </div>
    </SettingsSection>
  )
}
