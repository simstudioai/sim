'use client'

import { createContext, type ReactNode, useContext, useRef, useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import type { TabItem } from '@sim/emcn/tabs'
import { generateShortId } from '@sim/utils/id'
import { useRouter, useSearchParams } from 'next/navigation'
import { workspaceEntry } from '@/lib/navigation/paths'
import { PanelContent } from '@/app/(product)/_components/chat/panel/panel-content'
import { PanelTabs } from '@/app/(product)/_components/chat/panel/panel-tabs'
import styles from '@/app/(product)/_components/chat/panel/panels.module.css'
import { useDesktopHost } from '@/app/(product)/_components/desktop/desktop-host'
import { useRecentHistory } from '@/app/(product)/_components/session/interface-preferences'
import type { PanelData, PanelRecent } from '@/platform/lib/data/models/chat-panel'
import { platformHref } from '@/platform/lib/navigation'

export type PanelDestination = 'start' | 'workspaces' | 'terminal' | 'file' | 'website'
interface PanelTab {
  id: string
  view: PanelDestination
  resource?: PanelRecent
}

const tabs: Record<PanelDestination, Pick<TabItem, 'label' | 'icon'>> = {
  start: { label: 'New tab', icon: 'I041' },
  workspaces: { label: 'Workspaces' },
  terminal: { label: 'Terminal', icon: 'I107' },
  file: { label: 'File', icon: 'I015' },
  website: { label: 'Browser', icon: 'I041' },
}

export const OpenPanel = createContext<((element: HTMLButtonElement) => void) | null>(null)

/** The control that opens the chat panel, absent while the surface holds the panel back. */
export function ChatPanelTrigger() {
  const open = useContext(OpenPanel)
  if (!open) return null
  return (
    <span className={styles.openTrigger}>
      <IconButton
        icon='I038'
        label='Open chat panel'
        onClick={(event) => open(event.currentTarget)}
      />
    </span>
  )
}

interface ChatPanelsProps {
  children: ReactNode
  data: PanelData | null
  workspaces: readonly { id: string; name: string; href?: string }[]
}

export function ChatPanels({ children, data, workspaces }: ChatPanelsProps) {
  const desktop = useDesktopHost()
  const search = useSearchParams()
  const router = useRouter()
  const [visible, setVisible] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState<PanelTab[]>([{ id: 'initial', view: 'start' }])
  const [current, setCurrent] = useState('initial')
  const { recents, removeRecent } = useRecentHistory(data?.recents ?? [])
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
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
  function openWorkspace(id: string) {
    const href = workspaces.find((workspace) => workspace.id === id)?.href
    router.push(platformHref(href ?? workspaceEntry(id), search))
  }
  function recent(item: PanelRecent) {
    if (item.destination === 'workspace') openWorkspace(item.id)
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
          onWorkspace={openWorkspace}
          onVisit={visit}
          onRecent={recent}
          onRemove={removeRecent}
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
            add={<IconButton icon='I074' label='New panel tab' onClick={add} />}
            onExpand={() => setExpanded((value) => !value)}
            onHide={hide}
          />
        </aside>
      </div>
    </OpenPanel.Provider>
  )
}
