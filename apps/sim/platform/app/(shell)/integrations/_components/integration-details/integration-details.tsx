'use client'

import { type ReactNode, useLayoutEffect, useRef } from 'react'
import { ConnectedCredential } from '@/platform/app/(shell)/integrations/_components/connected-credential/connected-credential'
import { ConnectionAccess } from '@/platform/app/(shell)/integrations/_components/connection-access/connection-access'
import { ProviderHeading } from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading'
import { Chip } from '@/platform/design-system/components/button/button'
import { ConnectionPrompt } from '@/platform/design-system/components/connection-prompt/connection-prompt'
import { EmptyState } from '@/platform/design-system/components/empty-state/empty-state'
import {
  accountStatus,
  isConnectable,
  type OrganizationIntegration,
} from '@/platform/lib/integrations/model'

interface IntegrationDetailsProps {
  integration: OrganizationIntegration
  accountId: string | null
  integrationHref: string
  accountHref: (accountId: string) => string
  pending: boolean
  onConnect: () => void
  onReconnect: (accountId: string) => void
  onDisconnect: (accountId: string) => Promise<unknown>
  renderToolPermissions: (accountId: string) => ReactNode
}

export function IntegrationDetails({
  integration,
  accountId,
  integrationHref,
  accountHref,
  pending,
  onConnect,
  onReconnect,
  onDisconnect,
  renderToolPermissions,
}: IntegrationDetailsProps) {
  const { accounts, availability, connectionTarget, providerId, name } = integration
  const titleRef = useRef<HTMLHeadingElement>(null)
  const accountCount = useRef(accounts.length)
  useLayoutEffect(() => {
    if (accounts.length < accountCount.current) titleRef.current?.focus({ preventScroll: true })
    accountCount.current = accounts.length
  }, [accounts.length])
  const selected = accountId
    ? accounts.find((account) => account.id === accountId)
    : accounts.length === 1
      ? accounts[0]
      : undefined
  const stale = Boolean(accountId && !selected && !pending)
  const canConnect = isConnectable(integration)
  const shown = selected ? [selected] : accounts
  const reason =
    availability === 'managed'
      ? `Managed by your organization. ${integration.accessDescription}`
      : integration.status

  return (
    <>
      <ProviderHeading
        name={name}
        titleRef={titleRef}
        description={integration.description}
        providerId={providerId}
        icon={integration.icon}
      />
      {stale ? (
        <EmptyState
          title='This account is no longer connected.'
          action={<Chip href={integrationHref}>View integration</Chip>}
        />
      ) : shown.length > 0 ? (
        <ConnectedCredential
          integrationName={name}
          accounts={shown.map((account) => ({
            ...account,
            statusLabel: accountStatus(integration, account),
            href: !selected && account.hasToolPermissions ? accountHref(account.id) : undefined,
          }))}
          pending={pending}
          addAccount={
            connectionTarget && !accountId
              ? { disabled: !canConnect, onSelect: onConnect }
              : undefined
          }
          onReconnect={onReconnect}
          onDisconnect={onDisconnect}
        />
      ) : availability === 'managed' ? (
        <EmptyState
          title={reason}
          action={
            integration.setupGuideUrl && (
              <Chip href={integration.setupGuideUrl} icon='I079'>
                Docs
              </Chip>
            )
          }
        />
      ) : (
        <ConnectionPrompt
          title={canConnect ? `Connect your ${name} account` : reason}
          setupGuideUrl={integration.setupGuideUrl}
          options={[
            {
              label: name,
              icon: { providerId },
              onConnect: canConnect && !pending ? onConnect : undefined,
            },
          ]}
        />
      )}
      {selected?.hasToolPermissions && renderToolPermissions(selected.id)}
      {!stale && <ConnectionAccess integration={integration} />}
    </>
  )
}
