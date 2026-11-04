'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import { Button, IconButton } from '@/platform/design-system/components/controls'
import { Icon } from '@/platform/design-system/components/icon'
import styles from '@/platform/design-system/components/notification-tray.module.css'
import type { ShellNotice } from '@/platform/design-system/models/shell'

type Notice = Omit<ShellNotice, 'href'> & { onAction: () => void }
interface NoticeContext {
  notify: (notice: Notice) => void
  dismiss: (id: string) => void
}
const Notices = createContext<NoticeContext | null>(null)
export function usePlatformNotices() {
  const context = useContext(Notices)
  if (!context) throw new Error('Notifications need a product shell')
  return context
}

interface NotificationTrayProps {
  history: readonly ShellNotice[]
  navigate: (href: string) => void
  children: ReactNode
}
export function NotificationTray({ history, navigate, children }: NotificationTrayProps) {
  const [items, setItems] = useState<readonly (ShellNotice & { onAction?: () => void })[]>(history)
  const [display, setDisplay] = useState<'hidden' | 'latest' | 'expanded' | 'minimized'>('hidden')
  function notify(notice: Notice) {
    setItems((previous) => [...previous.filter((item) => item.id !== notice.id), notice])
    setDisplay((previous) => (previous === 'hidden' ? 'latest' : 'minimized'))
  }
  function dismiss(id: string) {
    setItems((previous) => previous.filter((item) => item.id !== id))
    if (display === 'latest') setDisplay('hidden')
  }
  const latest = items.at(-1)
  const shown = display === 'expanded' ? items : display === 'latest' && latest ? [latest] : []
  return (
    <Notices.Provider value={{ notify, dismiss }}>
      {children}
      {display !== 'hidden' && items.length > 0 && (
        <section aria-label='Notification stack' className={styles.stack} aria-live='polite'>
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
                  if (item.onAction) item.onAction()
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
      )}
    </Notices.Provider>
  )
}
