'use client'

import { type ReactNode, useState } from 'react'
import { toast } from '@sim/emcn'
import type { MemberIntegration } from '@/lib/credential-groups/member-integrations'
import { liveSearchSavedMemberProvider } from '@/lib/sim-search/live/source-catalog'
import { AccountConnectionActions } from '@/app/o/[organizationId]/integrations/account-connection-actions'
import { AccountToolPermissionsContent } from '@/app/o/[organizationId]/integrations/accounts/[credentialId]/tool-permissions'
import {
  CredentialDetailHeading,
  CredentialDetailLayout,
} from '@/app/workspace/[workspaceId]/components/credential-detail'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { SavedSearchCredentialModal } from '@/app/workspace/[workspaceId]/integrations/components/saved-search-credential-modal'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsField } from '@/app/workspace/[workspaceId]/settings/components/settings-field'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  useConnectOrganizationAccount,
  useReconnectPersonalOrganizationAccount,
} from '@/hooks/queries/organization-accounts'

interface IntegrationDetailProps {
  organizationId: string
  integration: MemberIntegration
  accountId: string | null
  accountHref: (accountId: string) => string
  back: ReactNode
  children?: ReactNode
}

type IntegrationAccount = MemberIntegration['accounts'][number]

/** Sites recorded for an account whose one grant reaches several, such as Confluence or Jira. */
function sitesOf(account: IntegrationAccount) {
  return 'sites' in account ? account.sites : []
}

function siteHost(url: string) {
  return url.replace(/^https:\/\//, '')
}

function accountSummary(account: IntegrationAccount) {
  const status = account.status === 'needs_reauth' ? 'Reconnect needed' : 'Connected'
  const count = sitesOf(account).length
  return count > 0 ? `${status} · ${count} ${count === 1 ? 'site' : 'sites'}` : status
}

function savedProviderIdFor(provider: string) {
  const providerId = liveSearchSavedMemberProvider(provider)
  return providerId === 'jama-service-account' || providerId === 'flow-service-account'
    ? providerId
    : null
}

/** The selected account owns every permission and connection action in this view. */
export function IntegrationDetail({
  organizationId,
  integration,
  accountId,
  accountHref,
  back,
  children,
}: IntegrationDetailProps) {
  const connect = useConnectOrganizationAccount()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const onError = (error: Error) => toast.error(error.message)
  const selected = accountId
    ? integration.accounts.find((account) => account.credentialId === accountId)
    : integration.accounts.length === 1
      ? integration.accounts[0]
      : undefined
  const target = integration.connectionTarget
  const savedProvider = savedProviderIdFor(integration.provider)
  const [savedConnection, setSavedConnection] = useState<{
    providerId: 'jama-service-account' | 'flow-service-account'
    credentialId?: string
    displayName?: string
  } | null>(null)
  return (
    <CredentialDetailLayout
      back={back}
      actions={
        !integration.managed && (
          <AccountConnectionActions
            key={selected?.credentialId ?? integration.id}
            organizationId={organizationId}
            integrationName={integration.name}
            account={selected}
            saved={Boolean(savedProvider)}
            connectLabel={integration.accounts.length ? 'Add account' : 'Connect'}
            onConnect={
              !target
                ? undefined
                : 'savedProviderId' in target
                  ? () => savedProvider && setSavedConnection({ providerId: savedProvider })
                  : () =>
                      connect.mutate(
                        { organizationId, ...target },
                        { onError, onSuccess: () => toast.success(`${integration.name} connected`) }
                      )
            }
            onReconnect={() => {
              if (!selected) return
              if (savedProvider)
                setSavedConnection({
                  providerId: savedProvider,
                  credentialId: selected.credentialId,
                  displayName: selected.displayName,
                })
              else
                reconnect.mutate(selected.credentialId, {
                  onError,
                  onSuccess: () => toast.success(`${integration.name} reconnected`),
                })
            }}
            connectionPending={connect.isPending || reconnect.isPending}
            canConnect={integration.ready}
            canReconnect={Boolean(
              selected && integration.reconnectAccountIds.includes(selected.credentialId)
            )}
          />
        )
      }
    >
      {children}
      <CredentialDetailHeading
        title={integration.name}
        subtitle={integration.description}
        leading={<IntegrationTile blockType={integration.provider} icon={integration.icon} />}
      />
      {integration.managed ? (
        <SettingsEmptyState variant='inline'>Organization managed</SettingsEmptyState>
      ) : (
        <SettingsSection label={selected ? 'Account' : 'Accounts'}>
          {accountId && !selected ? (
            <SettingsEmptyState variant='inline'>
              This account is no longer connected.
            </SettingsEmptyState>
          ) : selected ? (
            <div className='flex flex-col gap-4'>
              <SettingsField
                label={selected.status === 'needs_reauth' ? 'Reconnect needed' : 'Connected'}
                breakAll
              >
                {selected.displayName}
              </SettingsField>
              {sitesOf(selected).length > 0 && (
                <SettingsField label='Sites'>
                  <ul className='flex flex-col gap-1'>
                    {sitesOf(selected).map((site) => (
                      <li key={site.url} className='break-all text-[var(--text-body)] text-sm'>
                        {site.name}{' '}
                        <span className='text-[var(--text-muted)]'>{siteHost(site.url)}</span>
                      </li>
                    ))}
                  </ul>
                </SettingsField>
              )}
            </div>
          ) : integration.accounts.length ? (
            <div className={RESOURCE_LIST_STACK}>
              {integration.accounts.map((account) => (
                <SettingsResourceRow
                  key={account.credentialId}
                  title={account.displayName}
                  description={accountSummary(account)}
                  href={accountHref(account.credentialId)}
                  clickLabel={`Open ${account.displayName} account`}
                  navigable
                />
              ))}
            </div>
          ) : (
            <SettingsEmptyState variant='inline'>No account connected</SettingsEmptyState>
          )}
        </SettingsSection>
      )}
      {selected && integration.permissionAccountIds.includes(selected.credentialId) && (
        <AccountToolPermissionsContent
          key={selected.credentialId}
          organizationId={organizationId}
          credentialId={selected.credentialId}
        />
      )}
      {savedConnection && (
        <SavedSearchCredentialModal
          organizationId={organizationId}
          connection={savedConnection}
          onClose={() => setSavedConnection(null)}
          onCreated={() => setSavedConnection(null)}
        />
      )}
    </CredentialDetailLayout>
  )
}
