'use client'

import { type ReactNode, useState } from 'react'
import { Button } from '@/platform/design-system/components/button/button'
import { ConnectionPrompt } from '@/platform/design-system/components/connection-prompt/connection-prompt'
import { EmptyState } from '@/platform/design-system/components/empty-state/empty-state'
import type { MenuAction } from '@/platform/design-system/components/menu/action-menu'
import { ActionMenu } from '@/platform/design-system/components/menu/action-menu'
import { ConfirmDialog } from '@/platform/design-system/components/modal/confirm-dialog'
import { FailureNotice, InlineNotice } from '@/platform/design-system/components/status/status'
import { HomeSection } from '@/platform/embedded/app/(shell)/_components/home-section/home-section'
import styles from '@/platform/embedded/app/(shell)/home/_components/connected-widget/connected-widget.module.css'
import { WidgetSkeleton } from '@/platform/embedded/app/(shell)/home/_components/widget-skeleton/widget-skeleton'
import type {
  HomeAccountView,
  HomeWidgetActions,
  HomeWidgetState,
} from '@/platform/embedded/lib/data/home-view'

const DISCONNECT_NOTICE =
  'Sim will stop reading this account everywhere it is used, including Integrations. You can reconnect anytime.'

const COPY = {
  Email: { icon: 'I005', noun: 'email' },
  Calendar: { icon: 'I088', noun: 'calendar' },
} as const

interface ConnectedWidgetProps<T> {
  title: keyof typeof COPY
  state: HomeWidgetState<T>
  actions: HomeWidgetActions
  onHide: () => void
  children: (data: T) => ReactNode
}

interface AccountNoticesProps {
  accounts: readonly HomeAccountView[]
  onReconnect?: (accountId: string) => void
  onRetry: () => void
}

/** The accounts that did not contribute, listed above the ones that did. */
function AccountNotices({ accounts, onReconnect, onRetry }: AccountNoticesProps) {
  return accounts.map((account) => {
    if (account.problem === 'needs_reauth')
      return (
        <InlineNotice
          key={account.id}
          intent='warning'
          message={
            account.canReconnect
              ? `Reconnect ${account.label} to keep it up to date here.`
              : `${account.label} is paused. Ask an organization admin to turn it back on.`
          }
          action={
            account.canReconnect && onReconnect ? (
              <Button size='compact' onClick={() => onReconnect(account.id)}>
                Reconnect
              </Button>
            ) : undefined
          }
        />
      )
    if (account.problem === 'unavailable')
      return (
        <FailureNotice
          key={account.id}
          intent='warning'
          message={`${account.label} could not be reached.`}
          onRetry={onRetry}
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
  const { icon, noun } = COPY[title]
  const connected = 'accounts' in state ? state.accounts : []
  const several = connected.length > 1
  const menu: MenuAction[] = [{ id: 'hide', label: `Hide ${title}`, onSelect: onHide }]
  for (const account of connected) {
    menu.push({
      id: `disconnect-${account.id}`,
      destructive: true,
      separatorBefore: menu.length === 1,
      label: `Disconnect ${several ? account.label : title}`,
      onSelect: () => setDisconnecting(account),
    })
  }
  const reconnectable =
    state.status === 'needs_reauth' ? state.accounts.filter((a) => a.canReconnect) : []
  return (
    <HomeSection
      title={title}
      icon={icon}
      uncapped={state.status === 'ready' && state.accounts.some((account) => account.problem)}
      actions={<ActionMenu label={`${title} options`} icon='I108' align='end' actions={menu} />}
    >
      {state.status === 'loading' && <WidgetSkeleton label={`Loading your ${noun}`} />}
      {state.status === 'not_offered' && (
        <EmptyState
          title={`Your organization has not turned on ${noun}`}
          description='Ask an organization admin to set it up under Integrations.'
        />
      )}
      {state.status === 'not_connected' && (
        <div className={styles.connect} data-widget={title}>
          <ConnectionPrompt
            title={`Connect your ${noun}`}
            options={state.options.map(({ id, label, icon: mark }) => ({
              label,
              icon: mark,
              onConnect: actions.connect ? () => actions.connect?.(id) : undefined,
            }))}
          />
        </div>
      )}
      {state.status === 'needs_reauth' && (
        <EmptyState
          title={`Reconnect your ${noun}`}
          description={
            reconnectable.length
              ? `Sim can no longer read ${state.accounts.map((a) => a.label).join(', ')}.`
              : 'This connection is paused. Ask an organization admin to turn it back on.'
          }
          action={
            reconnectable.length && actions.reconnect
              ? reconnectable.map((account) => (
                  <Button
                    key={account.id}
                    size='compact'
                    onClick={() => actions.reconnect?.(account.id)}
                  >
                    {reconnectable.length > 1 ? `Reconnect ${account.label}` : 'Reconnect'}
                  </Button>
                ))
              : undefined
          }
        />
      )}
      {state.status === 'error' && (
        <FailureNotice
          intent='warning'
          message={`Your ${noun} could not load.`}
          retrying={state.retrying}
          onRetry={actions.retry}
        />
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
      <ConfirmDialog
        target={disconnecting !== null}
        onClose={() => setDisconnecting(null)}
        title={`Disconnect ${several && disconnecting ? disconnecting.label : title}?`}
        confirmLabel='Disconnect'
        pendingLabel='Disconnecting…'
        description={DISCONNECT_NOTICE}
        onConfirm={async () => {
          if (disconnecting) await actions.disconnect(disconnecting.id)
        }}
      />
    </HomeSection>
  )
}
