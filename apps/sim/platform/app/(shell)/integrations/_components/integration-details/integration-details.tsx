'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AccountAuthorization } from '@/platform/app/(shell)/integrations/_components/account-authorization/account-authorization'
import styles from '@/platform/app/(shell)/integrations/_components/integration-details/integration-details.module.css'
import { ToolPermissions } from '@/platform/app/(shell)/integrations/_components/tool-permissions/tool-permissions'
import {
  ActionMenu,
  ActivityRow,
  Button,
  Chip,
  EmptyState,
  Modal,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSurface,
} from '@/platform/design-system/components/settings-section/settings-section'
import type { IntegrationAccount, OrganizationIntegration } from '@/platform/lib/integrations/model'

interface IntegrationDetailsProps {
  integration: OrganizationIntegration
  onChange: (next: OrganizationIntegration) => void
}

type AccountAction =
  | { kind: 'connect' }
  | { kind: 'reconnect' | 'disconnect'; account: IntegrationAccount }

function accountStatus(account: IntegrationAccount) {
  return account.status === 'active' ? 'Connected' : 'Reconnect needed'
}

export function IntegrationDetails({ integration, onChange }: IntegrationDetailsProps) {
  const router = useRouter()
  const search = useSearchParams()
  const [action, setAction] = useState<AccountAction | null>(null)
  const { accounts, providerId, connectableMethod } = integration
  const requested = search.get('account')
  const selected = requested
    ? accounts.find((entry) => entry.id === requested)
    : accounts.length === 1
      ? accounts[0]
      : undefined
  const canConnect = integration.availability === 'ready' && connectableMethod !== null
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
    return (
      <EmptyState
        title='Organization managed'
        description='Your access follows your GitLab project permissions.'
      />
    )
  }

  return (
    <div className={styles.sections}>
      <section className={styles.account} aria-label={selected ? 'Account' : 'Accounts'}>
        <header className={styles.header}>
          <h2 data-type='T093'>{selected ? 'Account' : 'Accounts'}</h2>
          <div className={styles.actions}>
            {selected && accounts.length > 1 && <Chip href={accountHref()}>All accounts</Chip>}
            {canConnect && accounts.length > 0 && (
              <Button size='compact' onClick={() => setAction({ kind: 'connect' })}>
                Add account
              </Button>
            )}
          </div>
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
                          onSelect: () => setAction({ kind: 'reconnect', account: selected }),
                        },
                      ]
                    : []),
                  {
                    id: 'disconnect',
                    label: 'Disconnect account',
                    destructive: true,
                    separatorBefore: selected.canReconnect,
                    onSelect: () => setAction({ kind: 'disconnect', account: selected }),
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
        ) : (
          <EmptyState
            title='No accounts connected'
            action={
              canConnect ? (
                <Button size='compact' onClick={() => setAction({ kind: 'connect' })}>
                  Connect account
                </Button>
              ) : undefined
            }
          />
        )}
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
      {action?.kind === 'disconnect' && (
        <Modal
          open
          onOpenChange={() => setAction(null)}
          title='Disconnect account?'
          variant='confirm'
          destructive
          description={`Sim will lose access to ${action.account.label}.`}
          confirmLabel='Disconnect'
          onConfirm={() => disconnect(action.account)}
        />
      )}
      {action?.kind === 'connect' && canConnect && connectableMethod && (
        <AccountAuthorization
          provider={integration.name}
          method={connectableMethod}
          candidateLabel={candidate?.label}
          onClose={() => setAction(null)}
          onAuthorize={
            canAttach && candidate
              ? () => {
                  onChange({
                    ...integration,
                    accounts: [...accounts, candidate],
                    connectableMethod: null,
                    connectionCandidate: undefined,
                  })
                  router.replace(accountHref(candidate.id), { scroll: false })
                }
              : undefined
          }
        />
      )}
      {action?.kind === 'reconnect' && action.account.canReconnect && (
        <AccountAuthorization
          provider={integration.name}
          method={action.account.method}
          account={action.account}
          onClose={() => setAction(null)}
          onAuthorize={
            integration.fixtureAuthorization
              ? () =>
                  onChange({
                    ...integration,
                    accounts: accounts.map((entry) =>
                      entry.id === action.account.id ? { ...entry, status: 'active' } : entry
                    ),
                  })
              : undefined
          }
        />
      )}
    </div>
  )
}
