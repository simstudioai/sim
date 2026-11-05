'use client'

import { useLayoutEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ConnectionAccess } from '@/platform/app/(shell)/integrations/_components/connection-access/connection-access'
import { CredentialActions } from '@/platform/app/(shell)/integrations/_components/credential-actions/credential-actions'
import styles from '@/platform/app/(shell)/integrations/_components/integration-details/integration-details.module.css'
import { ProviderHeading } from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading'
import { ToolPermissions } from '@/platform/app/(shell)/integrations/_components/tool-permissions/tool-permissions'
import { ActivityRow, Chip, EmptyState } from '@/platform/design-system/components'
import { ConnectionPrompt } from '@/platform/design-system/components/connection-prompt/connection-prompt'
import {
  type IntegrationAccount,
  memberStatus,
  type OrganizationIntegration,
} from '@/platform/lib/integrations/model'

interface IntegrationDetailsProps {
  integration: OrganizationIntegration
  onChange: (next: OrganizationIntegration) => void
}

function accountStatus(integration: OrganizationIntegration, account: IntegrationAccount) {
  if (integration.availability !== 'ready') return memberStatus(integration)
  return account.status === 'active' ? 'Connected' : 'Reconnect needed'
}

export function IntegrationDetails({ integration, onChange }: IntegrationDetailsProps) {
  const router = useRouter()
  const search = useSearchParams()
  const { accounts, providerId, connectableMethod } = integration
  const titleRef = useRef<HTMLHeadingElement>(null)
  const returnToTitle = useRef(false)
  useLayoutEffect(() => {
    if (returnToTitle.current) {
      titleRef.current?.focus({ preventScroll: true })
      returnToTitle.current = false
    }
  }, [accounts.length])
  const requested = search.get('account')
  const selected = requested
    ? accounts.find((entry) => entry.id === requested)
    : accounts.length === 1
      ? accounts[0]
      : undefined
  const canConnect =
    !accounts.length && integration.availability === 'ready' && connectableMethod !== null
  const candidate = integration.connectionCandidate
  const canAttach =
    integration.fixtureAuthorization && canConnect && candidate?.method === connectableMethod

  function accountHref(id?: string) {
    const next = new URLSearchParams(search)
    next.delete('tools')
    if (id) next.set('account', id)
    else next.delete('account')
    return `/integrations/${encodeURIComponent(providerId)}${next.size ? `?${next}` : ''}`
  }

  function connect() {
    if (!canAttach || !candidate) return
    returnToTitle.current = true
    onChange({
      ...integration,
      accounts: [candidate],
      connectableMethod: null,
      connectionCandidate: undefined,
    })
  }

  function reconnect(account: IntegrationAccount) {
    if (!integration.fixtureAuthorization || !account.canReconnect) return
    onChange({
      ...integration,
      accounts: accounts.map((item) =>
        item.id === account.id ? { ...item, status: 'active' } : item
      ),
    })
  }

  function disconnect(account: IntegrationAccount) {
    returnToTitle.current = true
    const restore = integration.availability === 'ready' && account.canReconnect
    onChange({
      ...integration,
      accounts: accounts.filter((entry) => entry.id !== account.id),
      connectableMethod:
        integration.availability === 'ready'
          ? (connectableMethod ?? (restore ? account.method : null))
          : null,
      connectionCandidate:
        candidate ??
        (restore && integration.fixtureAuthorization
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
          : undefined),
    })
    if (requested === account.id) router.replace(accountHref(), { scroll: false })
  }

  function accountContent() {
    if (requested && !selected)
      return (
        <EmptyState
          title='This account is no longer connected'
          action={<Chip href={accountHref()}>View accounts</Chip>}
        />
      )
    if (selected) return accounts.length > 1 ? <Chip href={accountHref()}>All accounts</Chip> : null
    if (accounts.length)
      return (
        <section className={styles.account} aria-label='Accounts'>
          <h2 data-type='T093'>Accounts</h2>
          <ul className={styles.list}>
            {accounts.map((item) => (
              <ActivityRow
                key={item.id}
                title={item.label}
                detail={accountStatus(integration, item)}
                href={accountHref(item.id)}
              />
            ))}
          </ul>
        </section>
      )
    if (canConnect)
      return (
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
      )
    return (
      <EmptyState
        title={
          integration.availability === 'managed' ? 'Organization managed' : 'No accounts connected'
        }
        description={integration.accessDescription}
      />
    )
  }

  return (
    <>
      <ProviderHeading
        name={integration.name}
        titleRef={titleRef}
        description={integration.description}
        providerId={providerId}
        credential={
          selected && { label: selected.label, status: accountStatus(integration, selected) }
        }
        action={
          selected && (
            <CredentialActions
              account={selected}
              canAuthorize={Boolean(integration.fixtureAuthorization)}
              onReconnect={() => reconnect(selected)}
              onDisconnect={() => disconnect(selected)}
            />
          )
        }
      />
      {accountContent()}
      {selected?.permissions && (
        <ToolPermissions
          key={selected.id}
          account={selected}
          permissions={selected.permissions}
          onChange={(permissions) =>
            onChange({
              ...integration,
              accounts: accounts.map((entry) =>
                entry.id === selected.id ? { ...entry, permissions } : entry
              ),
            })
          }
        />
      )}
      {(!requested || selected) && <ConnectionAccess integration={integration} />}
    </>
  )
}
