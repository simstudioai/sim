'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ActionMenu,
  Avatar,
  Button,
  EmptyState,
  Icon,
  IconButton,
  SegmentedControl,
  TasksRunChart,
} from '@/platform/design-system/components'
import { useChatChanges } from '@/platform/design-system/components/chat-changes'
import { useInterfacePreferences } from '@/platform/design-system/components/interface-preferences'
import { MessageComposer } from '@/platform/design-system/components/message-composer'
import { Modal } from '@/platform/design-system/components/modal'
import { usePlatformNotices } from '@/platform/design-system/components/notification-tray'
import { useCompactViewport } from '@/platform/design-system/components/use-compact-viewport'
import { userTurn } from '@/platform/design-system/components/user-turn'
import { CalendarDay } from '@/platform/design-system/features/home/calendar-day'
import styles from '@/platform/design-system/features/home/home.module.css'
import type { HomeData, HomeRow, HomeWidget } from '@/platform/design-system/models/conversation'
import { platformHref } from '@/platform/design-system/navigation'

const widgets: readonly HomeWidget[] = ['Tasks run', 'Email', 'Calendar']

interface HomeScreenProps {
  data: HomeData | null
}
export function HomeScreen({ data }: HomeScreenProps) {
  const compact = useCompactViewport()
  const router = useRouter()
  const search = useSearchParams()
  const { createChat } = useChatChanges()
  const preferences = useInterfacePreferences()
  const { notify, dismiss } = usePlatformNotices()
  const [mode, setMode] = useState('Build')
  const [disconnect, setDisconnect] = useState<'Email' | 'Calendar' | null>(null)
  if (!preferences) throw new Error('Home needs interface preferences')
  const {
    hiddenWidgets: hidden,
    setHiddenWidgets: setHidden,
    connections,
    setConnections: setConnected,
  } = preferences
  const connected = {
    Email: data?.connected ?? false,
    Calendar: data?.connected ?? false,
    ...connections,
  }
  function visibility(widget: HomeWidget, show: boolean) {
    setHidden((current) =>
      show ? current.filter((item) => item !== widget) : [...current, widget]
    )
    const id = `hide-${widget}`
    if (show) dismiss(id)
    else
      notify({
        id,
        title: `${widget} hidden`,
        icon: 'I072',
        action: 'Undo',
        onAction: () => setHidden((current) => current.filter((item) => item !== widget)),
      })
  }
  const goHome = () => router.push(platformHref('/home', search))
  const personal = !hidden.includes('Email') || !hidden.includes('Calendar')
  const chart = !hidden.includes('Tasks run') && (
    <TasksRunChart
      title='Tasks run'
      inset={compact ? 'flush' : 'padded'}
      ranges={data?.ranges ?? []}
    />
  )
  const work = (
    <>
      <WorkList title='Needs your attention' rows={data?.attention ?? []} onOpen={goHome} />
      <WorkList title='Workspaces' rows={data?.workspaces ?? []} onOpen={goHome} />
    </>
  )
  return (
    <div className={styles.viewport}>
      <div className={styles.dashboard}>
        <header className={styles.greeting}>
          <div>
            <h1 data-type='T076'>
              {data?.firstName ? `Good morning, ${data.firstName}` : 'Good morning'}
            </h1>
            <p data-type='T048'>Your company’s knowledge and work, connected by Sim.</p>
          </div>
          <ActionMenu
            label='Customize Home'
            heading='Customize Home'
            icon='I108'
            align='end'
            actions={widgets.map((label) => ({
              id: label,
              label,
              checked: !hidden.includes(label),
              onSelect: () => visibility(label, hidden.includes(label)),
            }))}
          />
        </header>
        <section className={styles.compose} aria-label='Start a conversation'>
          <header className={styles.composeHeading}>
            <span className={styles.wordmark}>
              <Icon name='I113' label='Sim' />
            </span>
            <SegmentedControl
              label='Mode'
              options={[
                { value: 'Build', label: 'Build' },
                { value: 'Search', label: 'Search' },
              ]}
              defaultValue='Build'
              onSelect={setMode}
            />
          </header>
          <MessageComposer
            references={data?.references}
            placeholder={
              mode === 'Build'
                ? 'Ask about your business, or give Sim something to do…'
                : 'Search your company’s knowledge…'
            }
            onSubmit={(draft) => {
              const id = createChat(
                draft.text.slice(0, 70) || draft.attachments[0]?.name || 'New chat',
                [userTurn(draft)]
              )
              router.push(platformHref(`/chat/${id}`, search))
            }}
          />
        </section>
        <div className={styles.columns}>
          {personal ? (
            <div className={styles.column}>
              {chart}
              {work}
            </div>
          ) : (
            <>
              {chart}
              <div className={styles.column}>{work}</div>
            </>
          )}
          {personal && (
            <div className={styles.column}>
              {(['Email', 'Calendar'] as const)
                .filter((widget) => !hidden.includes(widget))
                .map((widget) => (
                  <section key={widget} aria-label={widget} className={styles.group}>
                    <header className={styles.groupHeading}>
                      <h2 data-type='T042'>
                        <Icon name={widget === 'Email' ? 'I005' : 'I088'} />
                        {widget}
                      </h2>
                      <div className={styles.widgetActions}>
                        <span className={styles.hideWidget}>
                          <IconButton
                            label={`Hide ${widget}`}
                            icon='I105'
                            onClick={() => visibility(widget, false)}
                          />
                        </span>
                        <ActionMenu
                          label={`${widget} options`}
                          icon='I108'
                          align='end'
                          actions={[
                            {
                              id: 'hide',
                              label: `Hide ${widget}`,
                              onSelect: () => visibility(widget, false),
                            },
                            ...(connected[widget]
                              ? [
                                  {
                                    id: 'disconnect',
                                    label: `Disconnect ${widget}`,
                                    onSelect: () => setDisconnect(widget),
                                  },
                                ]
                              : []),
                          ]}
                        />
                      </div>
                    </header>
                    {!connected[widget] ? (
                      <div className={styles.connect}>
                        <p data-type='T067'>Connect your {widget.toLowerCase()}</p>
                        <div>
                          {(widget === 'Email'
                            ? (['Gmail', 'Microsoft 365'] as const)
                            : (['Google Calendar', 'Outlook'] as const)
                          ).map((provider, i) => (
                            <Button
                              key={provider}
                              size='compact'
                              icon={
                                widget === 'Email' ? (i ? 'I085' : 'I005') : i ? 'I120' : 'I088'
                              }
                              onClick={() =>
                                setConnected((value) => ({ ...value, [widget]: true }))
                              }
                            >
                              {provider}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : widget === 'Calendar' ? (
                      <CalendarDay calendar={data?.calendar} />
                    ) : data?.email.length ? (
                      <ul className={styles.entries}>
                        {data.email.map((mail) => (
                          <li key={mail.id}>
                            <button type='button' className={styles.mailRow} onClick={goHome}>
                              <Avatar name={mail.sender} src={mail.avatar} />
                              <span className={styles.mailCopy}>
                                <span className={styles.sender} data-type='T059'>
                                  {mail.sender}{' '}
                                  {mail.count && <small data-type='T036'>{mail.count}</small>}
                                </span>
                                <span className={styles.previewText}>
                                  <strong data-type='T051'>{mail.subject}</strong>{' '}
                                  <span data-type='T052'>{mail.excerpt}</span>
                                </span>
                              </span>
                              <span className={styles.meta} data-type='T050'>
                                {mail.received}
                                <Icon name='I032' />
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState title='No email yet' />
                    )}
                  </section>
                ))}
            </div>
          )}
        </div>
      </div>
      <Modal
        open={disconnect !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnect(null)
        }}
        variant='confirm'
        title={`Disconnect ${disconnect ?? 'account'}?`}
        confirmLabel='Disconnect'
        destructive
        description={`Sim will stop syncing ${disconnect === 'Email' ? 'email' : 'calendar events'}${data?.address ? ` from ${data.address}` : ''}. You can reconnect anytime.`}
        onConfirm={() => {
          if (disconnect) setConnected((current) => ({ ...current, [disconnect]: false }))
          setDisconnect(null)
        }}
      />
    </div>
  )
}

interface WorkListProps {
  title: 'Workspaces' | 'Needs your attention'
  rows: HomeRow[]
  onOpen: () => void
}
function WorkList({ title, rows, onOpen }: WorkListProps) {
  const workspaces = title === 'Workspaces'
  return (
    <section aria-label={title} className={styles.group}>
      <header className={styles.groupHeading}>
        <h2 data-type='T042'>{title}</h2>
      </header>
      {rows.length ? (
        <ul className={styles.entries}>
          {rows.map((row) => (
            <li key={row.id}>
              <button className={styles.row} type='button' onClick={onOpen}>
                {!workspaces && (
                  <span className={styles.leading}>
                    <Icon name={row.icon} />
                  </span>
                )}
                <span className={styles.copy}>
                  <strong data-type='T059'>{row.title}</strong>
                  <span data-type='T050'>{row.detail}</span>
                </span>
                <span className={styles.meta} data-type='T052'>
                  {row.indicator && (
                    <span className={styles.activityIcon}>
                      <Icon name={row.indicator} />
                    </span>
                  )}
                  {row.meta}
                  <Icon name='I032' />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={workspaces ? 'Create your first workspace' : 'You’re all caught up'}
          description={
            workspaces
              ? 'Give a business process a place to run.'
              : 'Reviews and requests will appear here.'
          }
          action={
            workspaces ? (
              <Button size='compact' onClick={onOpen}>
                Create workspace
              </Button>
            ) : undefined
          }
        />
      )}
    </section>
  )
}
