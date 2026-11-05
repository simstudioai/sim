'use client'

import { createContext, type ReactNode, useContext, useRef, useState } from 'react'
import { generateShortId } from '@sim/utils/id'
import { useRouter, useSearchParams } from 'next/navigation'
import { useDesktopHost } from '@/platform/app/(shell)/_components/desktop/desktop-host'
import type { PanelData, PanelRecent } from '@/platform/app/(shell)/chat/_components/panel/model'
import { PanelContent } from '@/platform/app/(shell)/chat/_components/panel/panel-content'
import { PanelTabs } from '@/platform/app/(shell)/chat/_components/panel/panel-tabs'
import styles from '@/platform/app/(shell)/chat/_components/panel/panels.module.css'
import { IconButton } from '@/platform/design-system/components/button/button'
import { platformHref } from '@/platform/design-system/navigation'

export type PanelDestination = 'start' | 'workspaces' | 'terminal' | 'file' | 'website'
interface PanelTab {
  id: string
  view: PanelDestination
  resource?: PanelRecent
}

const tabs = {
  start: { label: 'New tab', icon: 'I041' },
  workspaces: { label: 'Workspaces', icon: 'I025' },
  terminal: { label: 'Terminal', icon: 'I107' },
  file: { label: 'File', icon: 'I015' },
  website: { label: 'Browser', icon: 'I041' },
} as const

const OpenPanel = createContext<((element: HTMLButtonElement) => void) | null>(null)

export function ChatPanelTrigger() {
  const open = useContext(OpenPanel)
  return (
    <span className={styles.openTrigger}>
      <IconButton
        icon='I038'
        label='Open chat panel'
        onClick={(event) => open?.(event.currentTarget)}
      />
    </span>
  )
}

interface ChatPanelsProps {
  children: ReactNode
  data: PanelData | null
  workspaces: readonly { id: string; name: string }[]
}

export function ChatPanels({ children, data, workspaces }: ChatPanelsProps) {
  const desktop = useDesktopHost()
  const search = useSearchParams()
  const router = useRouter()
  const [visible, setVisible] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState<PanelTab[]>([{ id: 'initial', view: 'start' }])
  const [current, setCurrent] = useState('initial')
  const [removed, setRemoved] = useState<string[]>([])
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const recents = (data?.recents ?? []).filter((item) => !removed.includes(item.id))
  function show(element: HTMLButtonElement) {
    trigger.current = element
    setVisible(true)
    requestAnimationFrame(() => {
      const controls = panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
      Array.from(controls ?? [])
        .find((control) => control.tabIndex >= 0 && control.getClientRects().length > 0)
        ?.focus()
    })
  }
  function hide() {
    setVisible(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }
  function add() {
    const id = generateShortId()
    setItems((list) => [...list, { id, view: 'start' }])
    setCurrent(id)
  }
  function remove(id: string) {
    const index = items.findIndex((tab) => tab.id === id)
    if (items.length === 1) {
      setItems([{ id: 'initial', view: 'start' }])
      setCurrent('initial')
      setExpanded(false)
      hide()
      return
    }
    setItems((list) => list.filter((tab) => tab.id !== id))
    if (current === id) setCurrent(items[index === 0 ? 1 : index - 1].id)
  }
  function visit(view: PanelDestination, resource?: PanelRecent) {
    setItems((list) => list.map((tab) => (tab.id === current ? { ...tab, view, resource } : tab)))
  }
  function home() {
    router.push(platformHref('/home', search))
  }
  function recent(item: PanelRecent) {
    if (item.destination === 'workspace') home()
    else visit(item.destination, item)
  }
  const tabViews = items.map((tab) => {
    const view = !desktop && tab.view === 'start' ? 'workspaces' : tab.view
    const meta = tabs[view]
    return {
      id: tab.id,
      content: (
        <PanelContent
          view={view}
          resource={tab.resource}
          desktop={desktop}
          data={data}
          recents={recents}
          workspaces={workspaces}
          onHome={home}
          onVisit={visit}
          onRecent={recent}
          onRemove={(id) => setRemoved((list) => [...list, id])}
        />
      ),
      icon: tab.resource?.icon ?? meta.icon,
      label: tab.resource?.label ?? meta.label,
    }
  })
  return (
    <OpenPanel.Provider value={show}>
      <div className={styles.frame} data-panel-open={visible} data-expanded={visible && expanded}>
        <div className={styles.conversation}>{children}</div>
        <aside ref={panel} className={styles.panel} aria-label='Chat panel' hidden={!visible}>
          <PanelTabs
            tabs={tabViews}
            current={current}
            expanded={expanded}
            onSelect={setCurrent}
            onRemove={remove}
            onAdd={add}
            onExpand={() => setExpanded((value) => !value)}
            onHide={hide}
          />
        </aside>
      </div>
    </OpenPanel.Provider>
  )
}
