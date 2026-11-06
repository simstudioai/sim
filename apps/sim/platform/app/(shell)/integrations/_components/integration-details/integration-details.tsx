'use client'

import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ConnectedCredential } from '@/platform/app/(shell)/integrations/_components/connected-credential/connected-credential'
import { ConnectionAccess } from '@/platform/app/(shell)/integrations/_components/connection-access/connection-access'
import { IntegrationControls } from '@/platform/app/(shell)/integrations/_components/integration-controls/integration-controls'
import { IntegrationIdea } from '@/platform/app/(shell)/integrations/_components/integration-idea/integration-idea'
import { IntegrationUsage } from '@/platform/app/(shell)/integrations/_components/integration-usage/integration-usage'
import { ProviderHeading } from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading'
import { Button, Chip, EmptyState, Modal } from '@/platform/design-system/components'
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
  const [connecting, setConnecting] = useState(false)
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
      />
      <IntegrationIdea
        providerId={providerId}
        name={name}
        example={
          providerId === 'fireflies'
            ? 'Use Fireflies to remember the interests prospects mention on calls. Turn those details into thoughtful gifts and personal follow-ups.'
            : `${integration.description.replace(/[.!?]+$/, '')}. Bring that context into your next conversation with Sim.`
        }
      />
      <IntegrationControls leading={<IntegrationUsage people={people ?? []} total={peopleTotal} />}>
        <Button
          variant='quiet'
          size='compact'
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
        {connectionTarget && (
          <Button
            size='compact'
            icon='I074'
            disabled={pending || !canConnect}
            onClick={() => setConnecting(true)}
          >
            Connect integration
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
          providerId={providerId}
          icon={integration.icon}
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
      {connecting && (
        <Modal
          open
          title={`Connect ${name}`}
          description={`Review access before continuing to ${name}.`}
          confirmLabel='Continue'
          confirmDisabled={pending || !canConnect}
          onOpenChange={setConnecting}
          onConfirm={onConnect}
        >
          <ConnectionAccess
            permissions={integration.requestedScopes ?? integration.searchReads}
            title={
              integration.requestedScopes?.length ? 'Requested permissions' : 'Connection access'
            }
          />
        </Modal>
      )}
    </>
  )
}
