'use client'

import { type ReactNode, useLayoutEffect, useRef } from 'react'
import Link from 'next/link'
import { ConnectedCredential } from '@/platform/app/(shell)/integrations/_components/connected-credential/connected-credential'
import { ConnectionAccess } from '@/platform/app/(shell)/integrations/_components/connection-access/connection-access'
import { IntegrationControls } from '@/platform/app/(shell)/integrations/_components/integration-controls/integration-controls'
import { ProviderHeading } from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading'
import { Button, Chip, EmptyState } from '@/platform/design-system/components'
import {
  accountStatus,
  isConnectable,
  type OrganizationIntegration,
} from '@/platform/lib/data/integrations-types'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'

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
  people?: readonly IntegrationPerson[]
  peopleTotal?: number
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
  people,
  peopleTotal,
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
  const stale = Boolean(accountId && !selected)
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
        people={people}
        peopleTotal={peopleTotal}
      />
      <IntegrationControls
        leading={
          <Button
            variant='quiet'
            icon='I082'
            render={
              <Link
                href={integration.setupGuideUrl}
                target='_blank'
                rel='noopener noreferrer'
                aria-label='Docs (opens in a new tab)'
              />
            }
          >
            Docs
          </Button>
        }
      >
        {connectionTarget && (
          <Button size='compact' icon='I074' disabled={pending || !canConnect} onClick={onConnect}>
            Add credential
          </Button>
        )}
      </IntegrationControls>
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
            statusLabel: accountStatus(integration),
            href: selected ? undefined : accountHref(account.id),
          }))}
          pending={pending}
          onReconnect={onReconnect}
          onDisconnect={onDisconnect}
        />
      ) : (
        <EmptyState
          title='No connected credentials'
          description={canConnect ? undefined : reason}
        />
      )}
      {selected?.hasToolPermissions && renderToolPermissions(selected.id)}
      {!stale && <ConnectionAccess integration={integration} />}
    </>
  )
}
