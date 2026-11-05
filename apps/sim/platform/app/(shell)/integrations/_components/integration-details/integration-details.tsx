'use client'

import { useLayoutEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ConnectedCredential } from '@/platform/app/(shell)/integrations/_components/connected-credential/connected-credential'
import { ConnectionAccess } from '@/platform/app/(shell)/integrations/_components/connection-access/connection-access'
import { ProviderHeading } from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading'
import { ToolPermissions } from '@/platform/app/(shell)/integrations/_components/tool-permissions/tool-permissions'
import { Chip, EmptyState } from '@/platform/design-system/components'
import { ConnectionPrompt } from '@/platform/design-system/components/connection-prompt/connection-prompt'
import {
  memberIntegrationHref,
  memberStatus,
  type OrganizationIntegration,
} from '@/platform/lib/integrations/model'

interface IntegrationDetailsProps {
  integration: OrganizationIntegration
  onChange: (next: OrganizationIntegration) => void
}

export function IntegrationDetails({ integration, onChange }: IntegrationDetailsProps) {
  const router = useRouter()
  const search = useSearchParams()
  const { account, providerId, connectableMethod, connectionCandidate } = integration
  const titleRef = useRef<HTMLHeadingElement>(null)
  const returnToTitle = useRef(false)
  useLayoutEffect(() => {
    if (returnToTitle.current) {
      titleRef.current?.focus({ preventScroll: true })
      returnToTitle.current = false
    }
  }, [account?.id])
  const requested = search.get('account')
  const staleCredential = Boolean(requested && requested !== account?.id)
  const providerHref = memberIntegrationHref(
    `/integrations/${encodeURIComponent(providerId)}`,
    search
  )
  const canConnect = !account && integration.availability === 'ready' && connectableMethod !== null
  const canAuthorize = Boolean(integration.fixtureAuthorization)
  const canAttach = canAuthorize && canConnect && connectionCandidate?.method === connectableMethod

  function connect() {
    if (!canAttach || !connectionCandidate) return
    returnToTitle.current = true
    onChange({
      ...integration,
      account: connectionCandidate,
      connectableMethod: null,
      connectionCandidate: undefined,
    })
  }

  function disconnect() {
    if (!account) return
    returnToTitle.current = true
    const restore = integration.availability === 'ready' && account.canReconnect
    onChange({
      ...integration,
      account: null,
      connectableMethod: restore ? account.method : null,
      connectionCandidate:
        restore && canAuthorize
          ? {
              ...account,
              status: 'active',
              permissions: account.permissions && {
                ...account.permissions,
                read: account.permissions.canAutoApprove ? 'allow' : 'ask',
                write: 'ask',
                tools: account.permissions.tools.map((tool) => ({ ...tool, override: null })),
              },
            }
          : undefined,
    })
    if (requested) router.replace(providerHref, { scroll: false })
  }

  return (
    <>
      <ProviderHeading
        name={integration.name}
        titleRef={titleRef}
        description={integration.description}
        providerId={providerId}
      />
      {account && !staleCredential && (
        <ConnectedCredential
          account={account}
          status={memberStatus(integration)}
          canAuthorize={canAuthorize}
          onReconnect={() => {
            if (canAuthorize && account.canReconnect)
              onChange({ ...integration, account: { ...account, status: 'active' } })
          }}
          onDisconnect={disconnect}
        />
      )}
      {staleCredential ? (
        <EmptyState
          title='This credential is no longer connected'
          action={<Chip href={providerHref}>View integration</Chip>}
        />
      ) : canConnect ? (
        <ConnectionPrompt
          title={`Connect your ${integration.name} account`}
          setupGuideUrl={integration.setupGuideUrl}
          options={[
            {
              label: integration.name,
              icon: { providerId },
              onConnect: canAttach ? connect : undefined,
            },
          ]}
        />
      ) : !account ? (
        <EmptyState
          title={
            integration.availability === 'managed'
              ? 'Organization managed'
              : 'No connected credential'
          }
          description={integration.accessDescription}
        />
      ) : null}
      {!staleCredential && account?.permissions && (
        <ToolPermissions
          key={account.id}
          account={account}
          permissions={account.permissions}
          onChange={(permissions) =>
            onChange({ ...integration, account: { ...account, permissions } })
          }
        />
      )}
      {!staleCredential && <ConnectionAccess integration={integration} />}
    </>
  )
}
