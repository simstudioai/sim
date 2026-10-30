'use client'

import type { ReactNode } from 'react'
import { toast } from '@sim/emcn'
import { AccountConnectionActions } from '@/app/o/[organizationId]/integrations/account-connection-actions'
import { AccountToolPermissionsContent } from '@/app/o/[organizationId]/integrations/accounts/[credentialId]/tool-permissions'
import type { MemberIntegration } from '@/app/o/[organizationId]/integrations/utils'
import {
  CredentialDetailHeading,
  CredentialDetailLayout,
} from '@/app/workspace/[workspaceId]/components/credential-detail'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
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
            connectLabel={integration.accounts.length ? 'Add account' : 'Connect'}
            onConnect={
              target ? () => connect.mutate({ organizationId, ...target }, { onError }) : undefined
            }
            onReconnect={() => {
              if (selected) reconnect.mutate(selected.credentialId, { onError })
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
            <SettingsField
              label={selected.status === 'needs_reauth' ? 'Reconnect needed' : 'Connected'}
              breakAll
            >
              {selected.displayName}
            </SettingsField>
          ) : integration.accounts.length ? (
            <div className={RESOURCE_LIST_STACK}>
              {integration.accounts.map((account) => (
                <SettingsResourceRow
                  key={account.credentialId}
                  title={account.displayName}
                  description={account.status === 'needs_reauth' ? 'Reconnect needed' : 'Connected'}
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
    </CredentialDetailLayout>
  )
}
