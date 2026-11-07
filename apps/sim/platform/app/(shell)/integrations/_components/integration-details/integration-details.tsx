'use client'

import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQueryStates } from 'nuqs'
import { ConnectedCredential } from '@/platform/app/(shell)/integrations/_components/connected-credential/connected-credential'
import { ConnectionAccess } from '@/platform/app/(shell)/integrations/_components/connection-access/connection-access'
import { IntegrationControls } from '@/platform/app/(shell)/integrations/_components/integration-controls/integration-controls'
import styles from '@/platform/app/(shell)/integrations/_components/integration-details/integration-details.module.css'
import { IntegrationIdea } from '@/platform/app/(shell)/integrations/_components/integration-idea/integration-idea'
import { IntegrationUsage } from '@/platform/app/(shell)/integrations/_components/integration-usage/integration-usage'
import { ProviderHeading } from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading'
import {
  Button,
  Chip,
  ContentTabs,
  EmptyState,
  Modal,
  TextField,
} from '@/platform/design-system/components'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import { credentialDetailParams } from '@/platform/lib/integrations/credential-navigation'
import { isConnectable, type OrganizationIntegration } from '@/platform/shared/integrations'

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
  const [view, setView] = useQueryStates(credentialDetailParams)
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

  const credentials = (
    <ConnectedCredential
      integrationName={name}
      providerId={providerId}
      icon={integration.icon}
      accounts={shown.map((account) => ({
        ...account,
        href: selected ? undefined : accountHref(account.id),
      }))}
      pending={pending}
      onReconnect={onReconnect}
      onDisconnect={onDisconnect}
    />
  )
  return (
    <>
      <ProviderHeading
        name={selected?.label ?? name}
        titleRef={titleRef}
        description={selected ? name : integration.description}
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
      <IntegrationControls
        leading={
          accounts.length === 0 ? (
            <IntegrationUsage people={people ?? []} total={peopleTotal} />
          ) : undefined
        }
      >
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
            variant='secondary'
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
      ) : selected ? (
        <ContentTabs
          label='Credential details'
          current={
            view.credentialTab === 'permissions' && !selected.hasToolPermissions
              ? 'details'
              : view.credentialTab
          }
          onSelect={(credentialTab) => {
            if (
              credentialTab === 'details' ||
              credentialTab === 'access' ||
              credentialTab === 'permissions'
            )
              void setView({ credentialTab })
          }}
          items={[
            {
              id: 'details',
              label: 'Details',
              content: (
                <div className={styles.details}>
                  <TextField
                    label='Credential ID'
                    placeholder='Credential ID'
                    value={selected.id}
                    viewOnly
                  />
                  {credentials}
                </div>
              ),
            },
            {
              id: 'access',
              label: 'Access',
              content: <EmptyState title='Access details are unavailable for this connection.' />,
            },
            ...(selected.hasToolPermissions
              ? [
                  {
                    id: 'permissions',
                    label: 'Permissions',
                    content: renderToolPermissions(selected.id),
                  },
                ]
              : []),
          ]}
        />
      ) : shown.length > 0 ? (
        credentials
      ) : (
        <EmptyState
          title='No connected credentials'
          description={canConnect ? undefined : reason}
        />
      )}
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
