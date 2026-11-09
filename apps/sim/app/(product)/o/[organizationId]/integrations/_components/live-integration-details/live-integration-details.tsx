'use client'

import { type ComponentType, type ReactNode, useState } from 'react'
import { Button, Chip } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import Link from 'next/link'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import { CredentialList } from '@/app/(product)/o/[organizationId]/integrations/_components/credential-list/credential-list'
import { IntegrationIdea } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-idea/integration-idea'
import { ProviderHeading } from '@/app/(product)/o/[organizationId]/integrations/_components/provider-heading/provider-heading'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'

/** One way to add a credential, as the connect menu lists it. */
export interface ConnectMethod {
  id: string
  label: string
  /** An OAuth sign-in, which names the action Connect rather than Create. */
  oauth: boolean
  onSelect: () => void
}

interface LiveIntegrationDetailsProps {
  app: {
    providerId: string
    icon?: ComponentType<{ className?: string }>
    name: string
    description: string
    docsUrl: string
    example: string
  }
  /** Every credential the viewer holds for this app; absent until they load. */
  credentials: readonly IntegrationCredential[] | undefined
  /** The credential the URL opens. */
  accountId: string | null
  integrationHref: string
  onOpen: (credential: IntegrationCredential) => void
  methods: readonly ConnectMethod[]
  /** Why nothing can be connected, when no method can. */
  unavailableReason: string
  pending: boolean
  /** The open credential's page; `disconnect` asks before removing it. */
  renderCredential: (credential: IntegrationCredential, disconnect: () => void) => ReactNode
  onDisconnect: (credential: IntegrationCredential) => Promise<unknown>
  /** Suggested skills and agent templates, below the credentials. */
  capabilities?: ReactNode
}

/**
 * An app's page on live data, in the anatomy of the example page: the provider heading, an idea,
 * Docs and the ways to connect, the connected credentials and what the app can do, or one open
 * credential's own page.
 */
export function LiveIntegrationDetails({
  app,
  credentials,
  accountId,
  integrationHref,
  onOpen,
  methods,
  unavailableReason,
  pending,
  renderCredential,
  onDisconnect,
  capabilities,
}: LiveIntegrationDetailsProps) {
  const [disconnecting, setDisconnecting] = useState<IntegrationCredential | null>(null)
  const hasOAuth = methods.some((method) => method.oauth)
  const connectLabel = hasOAuth ? 'Connect integration' : 'Create credential'

  if (accountId) {
    if (!credentials) return null
    const selected = credentials.find((credential) => credential.id === accountId)
    return (
      <>
        {selected ? (
          renderCredential(selected, () => setDisconnecting(selected))
        ) : (
          <EmptyState
            title='This account is no longer connected.'
            action={<Chip href={integrationHref}>View integration</Chip>}
          />
        )}
        {disconnecting && (
          <Modal
            open
            title={`Disconnect ${disconnecting.displayName}?`}
            description='People and workflows using this credential will lose access.'
            variant='confirm'
            destructive
            confirmLabel='Disconnect'
            onOpenChange={(open) => {
              if (!open) setDisconnecting(null)
            }}
            onConfirm={() => onDisconnect(disconnecting)}
          />
        )}
      </>
    )
  }

  return (
    <>
      <ProviderHeading
        name={app.name}
        description={app.description}
        providerId={app.providerId}
        icon={app.icon}
      />
      <IntegrationIdea providerId={app.providerId} name={app.name} example={app.example} />
      <ControlBar>
        <Button
          variant='quiet'
          size='compact'
          icon='I082'
          render={
            <Link
              href={app.docsUrl}
              target='_blank'
              rel='noopener noreferrer'
              aria-label='Docs (opens in a new tab)'
            />
          }
        >
          Docs
        </Button>
        {methods.length === 1 && hasOAuth ? (
          <Button icon='I074' size='compact' disabled={pending} onClick={methods[0].onSelect}>
            {connectLabel}
          </Button>
        ) : methods.length > 0 ? (
          <ActionMenu
            label={connectLabel}
            triggerSize='compact'
            triggerVariant='secondary'
            icon={null}
            tooltip={false}
            disabled={pending}
            actions={methods.map((method) => ({
              id: method.id,
              label: method.label,
              onSelect: method.onSelect,
            }))}
          />
        ) : (
          <Button size='compact' icon='I074' disabled disabledReason={unavailableReason}>
            Connect integration
          </Button>
        )}
      </ControlBar>
      {credentials && (
        <CredentialList providerId={app.providerId} credentials={credentials} onOpen={onOpen} />
      )}
      {capabilities}
    </>
  )
}
