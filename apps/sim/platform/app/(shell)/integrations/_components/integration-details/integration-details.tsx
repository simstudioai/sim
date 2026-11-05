'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ConnectionAccess } from '@/platform/app/(shell)/integrations/_components/connection-access/connection-access'
import styles from '@/platform/app/(shell)/integrations/_components/integration-details/integration-details.module.css'
import { ToolPermissions } from '@/platform/app/(shell)/integrations/_components/tool-permissions/tool-permissions'
import {
  ActionMenu,
  ActivityRow,
  Chip,
  EmptyState,
  Modal,
} from '@/platform/design-system/components'
import { ConnectionPrompt } from '@/platform/design-system/components/connection-prompt/connection-prompt'
import {
  SettingsRow,
  SettingsSurface,
} from '@/platform/design-system/components/settings-section/settings-section'
import type { IntegrationAccount, OrganizationIntegration } from '@/platform/lib/integrations/model'

interface IntegrationDetailsProps {
  integration: OrganizationIntegration
  onChange: (next: OrganizationIntegration) => void
}

function accountStatus(account: IntegrationAccount) {
  return account.status === 'active' ? 'Connected' : 'Reconnect needed'
}

export function IntegrationDetails({ integration, onChange }: IntegrationDetailsProps) {
  const router = useRouter()
  const search = useSearchParams()
  const [removing, setRemoving] = useState<IntegrationAccount | null>(null)
  const { accounts, providerId, connectableMethod } = integration
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
    integration.fixtureAuthorization &&
    canConnect &&
    candidate?.method === connectableMethod &&
    !accounts.some((account) => account.id === candidate?.id)

  function accountHref(id?: string) {
    const next = new URLSearchParams(search)
    next.delete('tools')
    if (id) next.set('account', id)
    else next.delete('account')
    return `/integrations/${encodeURIComponent(providerId)}${next.size ? `?${next}` : ''}`
  }

  function connect() {
    if (!canAttach || !candidate) return
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

  if (requested && !selected) {
    return (
      <EmptyState
        title='This account is no longer connected'
        action={<Chip href={accountHref()}>View accounts</Chip>}
      />
    )
  }
  if (integration.availability === 'managed' && !accounts.length) {
    return <EmptyState title='Organization managed' description={integration.accessDescription} />
  }

  const accountHeading = !selected && accounts.length > 1 ? 'Accounts' : 'Account'
  return (
    <div className={styles.sections}>
      <section className={styles.account} aria-label={accountHeading}>
        <header className={styles.header}>
          <h2 data-type='T093'>{accountHeading}</h2>
          {selected && accounts.length > 1 && <Chip href={accountHref()}>All accounts</Chip>}
        </header>
        {selected ? (
          <SettingsSurface>
            <SettingsRow label={selected.label} description={accountStatus(selected)}>
              <ActionMenu
                label={`Manage ${selected.label}`}
                icon='I108'
                triggerSize='compact'
                tooltip={false}
                actions={[
                  ...(selected.canReconnect
                    ? [
                        {
                          id: 'reconnect',
                          label: 'Reconnect account',
                          disabled: !integration.fixtureAuthorization,
                          onSelect: () => reconnect(selected),
                        },
                      ]
                    : []),
                  {
                    id: 'disconnect',
                    label: 'Disconnect account',
                    destructive: true,
                    separatorBefore: selected.canReconnect,
                    onSelect: () => setRemoving(selected),
                  },
                ]}
              />
            </SettingsRow>
          </SettingsSurface>
        ) : accounts.length ? (
          <ul className={styles.list}>
            {accounts.map((item) => (
              <ActivityRow
                key={item.id}
                title={item.label}
                detail={accountStatus(item)}
                href={accountHref(item.id)}
              />
            ))}
          </ul>
        ) : canConnect ? (
          <ConnectionPrompt
            title={`Connect your ${integration.name} account`}
            options={[
              {
                label: integration.name,
                icon: { providerId: integration.providerId },
                onConnect: canAttach ? connect : undefined,
              },
            ]}
          />
        ) : (
          <EmptyState title='No accounts connected' description={integration.accessDescription} />
        )}
        <ConnectionAccess integration={integration} />
      </section>
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
      {removing && (
        <Modal
          open
          onOpenChange={() => setRemoving(null)}
          title='Disconnect account?'
          variant='confirm'
          destructive
          description={`Sim will lose access to ${removing.label}.`}
          confirmLabel='Disconnect'
          onConfirm={() => disconnect(removing)}
        />
      )}
    </div>
  )
}
