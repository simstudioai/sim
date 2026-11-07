'use client'

import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { generateId } from '@sim/utils/id'
import type { ShellNotice } from '@/platform/app/(shell)/_components/model'
import styles from '@/platform/app/(shell)/_components/notification-tray/notification-tray.module.css'
import { ActivityBody } from '@/platform/design-system/components/activity-row/activity-body'
import { Button, IconButton } from '@/platform/design-system/components/button/button'
import { useFeedbackExpiry } from '@/platform/design-system/components/feedback/use-feedback-expiry'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import { connectToastSink } from '@/platform/shared/toast'

type Notice = Omit<ShellNotice, 'href'> & { onAction?: () => void }

/** What a view raises. The icon follows from the variant unless the notice names its own. */
type NoticeInput = Omit<Notice, 'icon'> & {
  icon?: Notice['icon']
  variant?: 'success' | 'error'
}

/** Where a view's notices go: this shell's tray. */
export interface PlatformNotices {
  notify: (notice: NoticeInput) => void
  dismiss: (id: string) => void
}
function useNoticeState() {
  const [edits, setEdits] = useState(() => new Map<string, Notice | null>())
  const [display, setDisplay] = useState<'hidden' | 'latest' | 'expanded' | 'minimized'>('hidden')
  function notify({ variant, ...input }: NoticeInput) {
    const notice: Notice = { ...input, icon: input.icon ?? (variant === 'error' ? 'I047' : 'I106') }
    setEdits((previous) => {
      const next = new Map(previous)
      next.delete(notice.id)
      return next.set(notice.id, notice)
    })
    setDisplay((previous) => (previous === 'hidden' ? 'latest' : 'minimized'))
  }
  function dismiss(id: string) {
    setEdits((previous) => new Map(previous).set(id, null))
    setDisplay((previous) => (previous === 'latest' ? 'hidden' : previous))
  }
  return { edits, display, setDisplay, notify, dismiss }
}

const Notices = createContext<ReturnType<typeof useNoticeState> | null>(null)

export function usePlatformNotices(): PlatformNotices {
  const notices = useContext(Notices)
  if (!notices) throw new Error('Notifications need a product shell')
  return notices
}

function useTrayState() {
  const state = useContext(Notices)
  if (!state) throw new Error('The notification tray needs a product shell')
  return state
}

export function NotificationSession({ children }: { children: ReactNode }) {
  const state = useNoticeState()
  return <Notices.Provider value={state}>{children}</Notices.Provider>
}

/** Delivers the toasts existing query hooks raise, as action-free notices unless they carry one. */
function useToastNotices() {
  const { notify, dismiss } = useTrayState()
  useEffect(
    () =>
      connectToastSink({
        show({ message, description, variant, action, noticeId }) {
          const id = noticeId ?? generateId()
          notify({
            id,
            title: message,
            description,
            icon: variant === 'error' || variant === 'warning' ? 'I047' : 'I106',
            action: action?.label,
            onAction: action?.onClick,
          })
          return id
        },
        dismiss,
      }),
    // notify and dismiss only write state, so the first render's pair stays correct.
    []
  )
}

interface NotificationTrayProps {
  history: readonly ShellNotice[]
  navigate: (href: string) => void
}
export function NotificationTray({ history, navigate }: NotificationTrayProps) {
  useToastNotices()
  const scrollEdges = useScrollEdges<HTMLDivElement>()
  const { edits, display, setDisplay, dismiss } = useTrayState()
  const items = [
    ...history.filter((item) => !edits.has(item.id)),
    ...[...edits.values()].filter((item) => item !== null),
  ]
  const latest = items.at(-1)
  const [engaged, setEngaged] = useState<typeof latest>(undefined)
  useFeedbackExpiry(display === 'latest' && engaged !== latest ? latest : null, () =>
    setDisplay('minimized')
  )
  const shown = display === 'expanded' ? items : display === 'latest' && latest ? [latest] : []
  if (display === 'hidden' || !items.length) return null
  return (
    <section
      onPointerEnter={() => setEngaged(latest)}
      onPointerLeave={(event) =>
        setEngaged(event.currentTarget.matches(':focus-within') ? latest : undefined)
      }
      onFocus={() => setEngaged(latest)}
      onBlur={(event) =>
        setEngaged(
          event.currentTarget.contains(event.relatedTarget) || event.currentTarget.matches(':hover')
            ? latest
            : undefined
        )
      }
      aria-label='Notification stack'
      className={styles.stack}
      aria-live='polite'
    >
      {display !== 'latest' && (
        <Button
          size='compact'
          count={items.length}
          render={<button type='button' aria-expanded={display === 'expanded'} />}
          onClick={() => setDisplay(display === 'expanded' ? 'minimized' : 'expanded')}
        >
          {items.length === 1 ? 'Notification' : 'Notifications'}
        </Button>
      )}
      {shown.length > 0 && (
        <div className={styles.surface} data-elevation='control'>
          <div ref={scrollEdges} className={styles.notices}>
            {shown.map((item) => (
              <article
                key={item.id}
                aria-label={item.title}
                className={styles.notice}
                data-material='floating'
              >
                <ActivityBody
                  leading={
                    display === 'latest' && items.length > 1 ? (
                      <IconButton
                        label='View all notifications'
                        icon={item.icon}
                        size='compact'
                        onClick={() => setDisplay('expanded')}
                      />
                    ) : (
                      <Icon name={item.icon} />
                    )
                  }
                >
                  <span data-type='T059'>{item.title}</span>
                  {item.description && (
                    <span className={styles.description} data-type='T052'>
                      {item.description}
                    </span>
                  )}
                </ActivityBody>
                <div className={styles.actions}>
                  {item.action && (
                    <Button
                      size='compact'
                      onClick={() => {
                        dismiss(item.id)
                        if ('onAction' in item) item.onAction?.()
                        else if ('href' in item && item.href) navigate(item.href)
                      }}
                    >
                      {item.action}
                    </Button>
                  )}
                  <IconButton
                    size='compact'
                    label={`Dismiss ${item.title}`}
                    icon='I105'
                    onClick={() => dismiss(item.id)}
                  />
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
