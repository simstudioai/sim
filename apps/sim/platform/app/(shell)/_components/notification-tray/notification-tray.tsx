'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import type { ShellNotice } from '@/platform/app/(shell)/_components/model'
import styles from '@/platform/app/(shell)/_components/notification-tray/notification-tray.module.css'
import { Button, IconButton } from '@/platform/design-system/components/button/button'
import { useFeedbackExpiry } from '@/platform/design-system/components/feedback/use-feedback-expiry'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'

type Notice = Omit<ShellNotice, 'href'> & { onAction: () => void }
function useNoticeState() {
  const [edits, setEdits] = useState(() => new Map<string, Notice | null>())
  const [display, setDisplay] = useState<'hidden' | 'latest' | 'expanded' | 'minimized'>('hidden')
  function notify(notice: Notice) {
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

export function usePlatformNotices() {
  const context = useContext(Notices)
  if (!context) throw new Error('Notifications need a product shell')
  return context
}

export function NotificationSession({ children }: { children: ReactNode }) {
  const state = useNoticeState()
  return <Notices.Provider value={state}>{children}</Notices.Provider>
}

interface NotificationTrayProps {
  history: readonly ShellNotice[]
  navigate: (href: string) => void
}
export function NotificationTray({ history, navigate }: NotificationTrayProps) {
  const scrollEdges = useScrollEdges<HTMLElement>()
  const { edits, display, setDisplay, dismiss } = usePlatformNotices()
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
      ref={scrollEdges}
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
        <button
          type='button'
          aria-expanded={display === 'expanded'}
          className={styles.count}
          data-material='floating'
          data-type={display === 'minimized' ? 'T060' : 'T052'}
          onClick={() => setDisplay(display === 'expanded' ? 'minimized' : 'expanded')}
        >
          {display === 'minimized' && <Icon name='I106' />}
          {items.length} {items.length === 1 ? 'notification' : 'notifications'}
          <Icon name='I051' />
        </button>
      )}
      {shown.map((item) => (
        <article
          key={item.id}
          aria-label={item.title}
          className={styles.notice}
          data-material='floating'
          data-elevation='menu'
        >
          {display === 'latest' && items.length > 1 ? (
            <IconButton
              label='View all notifications'
              icon={item.icon}
              onClick={() => setDisplay('expanded')}
            />
          ) : (
            <Icon name={item.icon} />
          )}
          <span className={styles.copy}>
            <span data-type='T059'>{item.title}</span>
            {item.description && <span data-type='T052'>{item.description}</span>}
          </span>
          <Button
            size='compact'
            onClick={() => {
              dismiss(item.id)
              if ('onAction' in item) item.onAction()
              else if (item.href) navigate(item.href)
            }}
          >
            {item.action}
          </Button>
          <IconButton
            label={`Dismiss ${item.title}`}
            icon='I105'
            onClick={() => dismiss(item.id)}
          />
        </article>
      ))}
    </section>
  )
}
