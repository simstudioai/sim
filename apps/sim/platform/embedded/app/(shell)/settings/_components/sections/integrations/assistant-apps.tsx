'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import Link from 'next/link'
import type { ViewerSearchSourceAccount } from '@/lib/api/contracts/knowledge/connectors'
import type { SearchIntegrationStatus } from '@/lib/api/contracts/knowledge/search-integrations'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import { assistantSearchSourceForProvider } from '@/lib/assistant-actions/providers'
import { CREDENTIAL_GROUP_ACCOUNTS_PER_PROVIDER_LIMIT } from '@/lib/credential-groups/limits'
import { assistantAccountOptions } from '@/lib/credential-groups/member-integrations'
import {
  getCredentialGroupProviderId,
  getCredentialGroupProviderService,
} from '@/lib/credential-groups/providers'
import { organizationRoutes } from '@/lib/navigation/paths'
import { IntegrationMark } from '@/platform/embedded/app/(shell)/_components/integration-mark/integration-mark'
import { Muted } from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import {
  useAssistantAppActions,
  usePersonalAccountDisconnect,
} from '@/platform/embedded/lib/data/integrations'

interface AssistantAppsProps {
  organizationId: string
  search: string
  data: OrganizationAccountsSettings
  policies: SearchIntegrationStatus[] | undefined
}

/** Apps without a Search connector use the same personal enrollment and approval controls. */
export function AssistantApps({ organizationId, search, data, policies }: AssistantAppsProps) {
  const actions = useAssistantAppActions(organizationId)
  const group = data.credentialGroup
  const { providers, visible } = assistantAccountOptions(data, search)
  const query = search.trim().toLowerCase()
  const available = providers.filter(
    (provider) =>
      getCredentialGroupProviderService(provider).name.toLowerCase().includes(query) &&
      data.availableProviders.includes(provider) &&
      !group?.options.some((option) => option.provider === provider)
  )
  if (!visible.length && !available.length) return null
  return (
    <SettingsSection title='Assistant apps'>
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
          <SettingsRow
            key={option.id}
            label={service.name}
            leading={<IntegrationMark providerId={option.provider} icon={service.icon} />}
            description={
              accounts.length
                ? accounts.map((account) => account.displayName).join(', ')
                : source && !policies
                  ? undefined
                  : ready
                    ? 'No account connected'
                    : 'Connections unavailable'
            }
          >
            <AccountActions
              organizationId={organizationId}
              integrationName={service.name}
              accounts={accounts}
              onConnect={
                accounts.length < CREDENTIAL_GROUP_ACCOUNTS_PER_PROVIDER_LIMIT
                  ? () => actions.connect(option.id)
                  : undefined
              }
              onReconnect={actions.reconnect}
              connectionPending={actions.connectionPending}
              connecting={actions.connectingOptionId === option.id}
              connectionReady={ready}
              reconnectAccountIds={ready ? accounts.map((account) => account.credentialId) : []}
              permissionAccountIds={
                data.assistantProviders.includes(option.provider)
                  ? accounts.map((account) => account.credentialId)
                  : []
              }
            />
          </SettingsRow>
        )
      })}
      {available.length > 0 && (
        <SettingsRow label='New Assistant app'>
          <SearchableSelect
            label='Add Assistant app'
            labelHidden
            searchLabel='Search apps'
            placeholder='Add app'
            value={null}
            disabled={actions.adding}
            options={available.map((provider) => ({
              value: provider,
              label: getCredentialGroupProviderService(provider).name,
            }))}
            onValueChange={(value) => {
              const provider = available.find((candidate) => candidate === value)
              if (provider && provider !== 'slack') actions.add(provider)
            }}
          />
        </SettingsRow>
      )}
    </SettingsSection>
  )
}

interface AccountActionsProps {
  organizationId: string
  integrationName: string
  accounts: ViewerSearchSourceAccount[]
  onConnect?: () => void
  onReconnect: (credentialId: string) => void
  connectionPending: boolean
  connecting: boolean
  connectionReady: boolean
  permissionAccountIds: readonly string[]
  reconnectAccountIds: readonly string[]
}

function AccountActions({
  organizationId,
  integrationName,
  accounts,
  onConnect,
  onReconnect,
  connectionPending,
  connecting,
  connectionReady,
  permissionAccountIds,
  reconnectAccountIds,
}: AccountActionsProps) {
  const disconnect = usePersonalAccountDisconnect(organizationId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = accounts.find((account) => account.credentialId === selectedId)
  const permissionAccounts = accounts.filter((account) =>
    permissionAccountIds.includes(account.credentialId)
  )
  const pending = connectionPending || disconnect.pending
  const suffix = (account: ViewerSearchSourceAccount) =>
    accounts.length > 1 ? ` · ${account.displayName}` : ''
  if (!accounts.length && !onConnect) return null
  return (
    <>
      {permissionAccounts.map((account) => (
        <Button
          key={account.credentialId}
          size='compact'
          variant='quiet'
          render={
            <Link
              href={organizationRoutes(organizationId).accountToolPermissions(account.credentialId)}
            />
          }
        >
          {`Tool permissions${suffix(account)}`}
        </Button>
      ))}
      <ActionMenu
        label={`${integrationName} integration actions`}
        icon='I108'
        actions={[
          ...accounts.map((account) => ({
            id: `reconnect-${account.credentialId}`,
            label: `Reconnect${suffix(account)}`,
            disabled: pending || !reconnectAccountIds.includes(account.credentialId),
            onSelect: () => onReconnect(account.credentialId),
          })),
          ...(onConnect
            ? [
                {
                  id: 'connect',
                  label: connecting ? 'Connecting' : accounts.length ? 'Add account' : 'Connect',
                  disabled: pending || !connectionReady,
                  separatorBefore: accounts.length > 0,
                  onSelect: onConnect,
                },
              ]
            : []),
          ...accounts.map((account, index) => ({
            id: `disconnect-${account.credentialId}`,
            label: `Disconnect${suffix(account)}`,
            destructive: true,
            disabled: pending,
            separatorBefore: index === 0,
            onSelect: () => {
              disconnect.reset()
              setSelectedId(account.credentialId)
            },
          })),
        ]}
      />
      {selected && (
        <ConfirmDialog
          target
          onClose={() => setSelectedId(null)}
          title={`Disconnect ${integrationName}`}
          confirmLabel='Disconnect'
          pendingLabel='Disconnecting…'
          onConfirm={() => disconnect.disconnect(selected.credentialId)}
        >
          <Muted>
            {`Disconnect ${selected.displayName} from this organization. Workflows using this account will also lose access. You can reconnect later.`}
          </Muted>
        </ConfirmDialog>
      )}
    </>
  )
}
