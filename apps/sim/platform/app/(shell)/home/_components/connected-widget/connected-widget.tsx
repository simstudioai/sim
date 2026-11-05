'use client'

import { type ReactNode, useState } from 'react'
import styles from '@/platform/app/(shell)/home/_components/connected-widget/connected-widget.module.css'
import { HomeSection } from '@/platform/app/(shell)/home/_components/home-section/home-section'
import type {
  HomeAccountView,
  HomeWidgetActions,
  HomeWidgetState,
} from '@/platform/app/(shell)/home/_components/model'
import { WidgetSkeleton } from '@/platform/app/(shell)/home/_components/widget-skeleton/widget-skeleton'
import { ActionMenu, Button, EmptyState, InlineNotice } from '@/platform/design-system/components'
import { ConnectionPrompt } from '@/platform/design-system/components/connection-prompt/connection-prompt'
import type { MenuAction } from '@/platform/design-system/components/menu/action-menu'
import { Modal } from '@/platform/design-system/components/modal/modal'

const COPY = {
  Email: { icon: 'I005', noun: 'email', synced: 'email', loading: 'Loading your email' },
  Calendar: {
    icon: 'I088',
    noun: 'calendar',
    synced: 'calendar events',
    loading: 'Loading your calendar',
  },
} as const

interface ConnectedWidgetProps<T> {
  title: keyof typeof COPY
  state: HomeWidgetState<T>
  actions: HomeWidgetActions
  onHide: () => void
  children: (data: T) => ReactNode
}

function ReconnectButton({
  account,
  onReconnect,
}: {
  account: HomeAccountView
  onReconnect?: (accountId: string) => void
}) {
  if (!account.canReconnect || !onReconnect) return null
  return (
    <Button size='compact' onClick={() => onReconnect(account.id)}>
      Reconnect
    </Button>
  )
}

/** The accounts that did not contribute, listed above the ones that did. */
function AccountNotices({
  accounts,
  onReconnect,
  onRetry,
}: {
  accounts: readonly HomeAccountView[]
  onReconnect?: (accountId: string) => void
  onRetry?: () => void
}) {
  return accounts.map((account) => {
    if (account.problem === 'needs_reauth')
      return (
        <InlineNotice
          key={account.id}
          intent='warning'
          message={`Reconnect ${account.label} to keep it up to date here.`}
          action={<ReconnectButton account={account} onReconnect={onReconnect} />}
        />
      )
    if (account.problem === 'unavailable')
      return (
        <InlineNotice
          key={account.id}
          intent='warning'
          message={`${account.label} could not be reached.`}
          action={
            onRetry && (
              <Button size='compact' onClick={onRetry}>
                Try again
              </Button>
            )
          }
        />
      )
    if (account.problem === 'not_offered')
      return (
        <InlineNotice
          key={account.id}
          message={`Your organization does not allow ${account.label} here.`}
        />
      )
    if (account.problem === 'not_read')
      return (
        <InlineNotice
          key={account.id}
          message={`${account.label} is not shown. Home reads a limited number of accounts.`}
        />
      )
    return null
  })
}

export function ConnectedWidget<T>({
  title,
  state,
  actions,
  onHide,
  children,
}: ConnectedWidgetProps<T>) {
  const [disconnecting, setDisconnecting] = useState<HomeAccountView | null>(null)
  const copy = COPY[title]
  const connected =
    state.status === 'ready'
      ? state.accounts
      : state.status === 'needs_reauth'
        ? state.accounts
        : []
  const menu: MenuAction[] = [{ id: 'hide', label: `Hide ${title}`, onSelect: onHide }]
  for (const account of connected) {
    menu.push({
      id: `disconnect-${account.id}`,
      destructive: true,
      label: connected.length === 1 ? `Disconnect ${title}` : `Disconnect ${account.label}`,
      onSelect: () => setDisconnecting(account),
    })
  }
  const address = disconnecting?.label || actions.address
  return (
    <HomeSection
      title={title}
      icon={copy.icon}
      actions={<ActionMenu label={`${title} options`} icon='I108' align='end' actions={menu} />}
    >
      {state.status === 'loading' && <WidgetSkeleton label={copy.loading} />}
      {state.status === 'not_offered' && (
        <div className={styles.connect}>
          <EmptyState
            title={`Your organization has not turned on ${copy.noun}`}
            description='Ask an organization admin to set it up under Integrations.'
          />
        </div>
      )}
      {state.status === 'not_connected' && (
        <div className={styles.connect}>
          <ConnectionPrompt
            title={`Connect your ${copy.noun}`}
            options={state.options.map(({ id, label, icon }) => ({
              label,
              icon,
              onConnect: actions.connect ? () => actions.connect?.(id) : undefined,
            }))}
          />
        </div>
      )}
      {state.status === 'needs_reauth' && (
        <div className={styles.connect}>
          <EmptyState
            title={`Reconnect your ${copy.noun}`}
            description={
              state.accounts.some((account) => account.canReconnect)
                ? `Sim can no longer read ${state.accounts.map((a) => a.label).join(', ')}.`
                : 'This connection is paused. Ask an organization admin to turn it back on.'
            }
            action={state.accounts.map((account) => (
              <ReconnectButton key={account.id} account={account} onReconnect={actions.reconnect} />
            ))}
          />
        </div>
      )}
      {state.status === 'error' && (
        <div className={styles.connect}>
          <EmptyState
            title={`Your ${copy.noun} could not load`}
            action={
              <Button size='compact' disabled={state.retrying} onClick={actions.retry}>
                Try again
              </Button>
            }
          />
        </div>
      )}
      {state.status === 'ready' && (
        <>
          <AccountNotices
            accounts={state.accounts}
            onReconnect={actions.reconnect}
            onRetry={actions.retry}
          />
          {children(state.data)}
        </>
      )}
      <Modal
        open={disconnecting !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnecting(null)
        }}
        variant='confirm'
        title={
          connected.length > 1 && disconnecting
            ? `Disconnect ${disconnecting.label}?`
            : `Disconnect ${title}?`
        }
        confirmLabel='Disconnect'
        destructive
        description={
          actions.disconnectNotice ??
          `Sim will stop syncing ${copy.synced}${address ? ` from ${address}` : ''}. You can reconnect anytime.`
        }
        onConfirm={async () => {
          if (disconnecting) await actions.disconnect?.(disconnecting.id)
        }}
      />
    </HomeSection>
  )
}
