'use client'

import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react'
import { ControlRow } from '@sim/emcn/button/control-row'
import { useShallow } from 'zustand/react/shallow'
import { EditorPanel } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/editor-panel/editor-panel'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/right-panel/right-panel.module.css'
import {
  Toolbar,
  type ToolbarRef,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/toolbar/toolbar'
import {
  PANEL_WIDTH,
  usePanelEditorStore,
  usePanelStore,
  useVariablesModalStore,
} from '@/platform/lib/data/workflows'

/** The panel's tabs. Variables live here rather than in the legacy floating window. */
export type RightPanelTab = 'toolbar' | 'editor' | 'variables'

const TABS: readonly { id: RightPanelTab; label: string }[] = [
  { id: 'toolbar', label: 'Toolbar' },
  { id: 'editor', label: 'Editor' },
  { id: 'variables', label: 'Variables' },
]

/** The legacy clamp: at least the minimum, at most 40% of the window. */
function clampPanelWidth(width: number) {
  const maxWidth = Math.max(PANEL_WIDTH.MIN, window.innerWidth * PANEL_WIDTH.MAX_PERCENTAGE)
  return Math.min(Math.max(width, PANEL_WIDTH.MIN), maxWidth)
}

/**
 * The tab the panel shows. The panel store keeps Toolbar or Editor as legacy does (selecting a
 * block opens the Editor); the legacy variables window's open flag stands for the Variables tab, so
 * the canvas menu's Variables command still opens it. A stored Copilot tab, removed here, reads as
 * the Toolbar.
 */
export function useRightPanelTab(): [RightPanelTab, (tab: RightPanelTab) => void] {
  const { storedTab, setActiveTab } = usePanelStore(
    useShallow((state) => ({ storedTab: state.activeTab, setActiveTab: state.setActiveTab }))
  )
  const { variablesOpen, setVariablesOpen } = useVariablesModalStore(
    useShallow((state) => ({ variablesOpen: state.isOpen, setVariablesOpen: state.setIsOpen }))
  )
  const current: RightPanelTab = variablesOpen
    ? 'variables'
    : storedTab === 'editor'
      ? 'editor'
      : 'toolbar'
  const select = (tab: RightPanelTab) => {
    if (tab === 'variables') {
      setVariablesOpen(true)
      return
    }
    setVariablesOpen(false)
    setActiveTab(tab)
  }
  return [current, select]
}

/** Opening a block in the editor takes the panel off Variables, as the Editor tab is where it shows. */
function useEditorFollowsSelection() {
  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const storedTab = usePanelStore((state) => state.activeTab)
  const setVariablesOpen = useVariablesModalStore((state) => state.setIsOpen)
  const previous = useRef({ currentBlockId, storedTab })
  useEffect(() => {
    const changed =
      previous.current.currentBlockId !== currentBlockId || previous.current.storedTab !== storedTab
    previous.current = { currentBlockId, storedTab }
    if (changed) setVariablesOpen(false)
  }, [currentBlockId, storedTab, setVariablesOpen])
}

/** Width from the persisted panel store, and a drag handle that commits once on release. */
function usePanelWidth(panelRef: RefObject<HTMLElement | null>) {
  const panelWidth = usePanelStore((state) => state.panelWidth)
  const setPanelWidth = usePanelStore((state) => state.setPanelWidth)
  useLayoutEffect(() => {
    panelRef.current?.style.setProperty('inline-size', `${clampPanelWidth(panelWidth)}px`)
  }, [panelRef, panelWidth])
  return (event: PointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current
    if (!panel) return
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const right = panel.getBoundingClientRect().right
    let width = panel.getBoundingClientRect().width
    const move = (moveEvent: globalThis.PointerEvent) => {
      width = clampPanelWidth(right - moveEvent.clientX)
      panel.style.setProperty('inline-size', `${width}px`)
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      setPanelWidth(width)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }
}

interface RightPanelProps {
  toolbarRef: RefObject<ToolbarRef | null>
  /** The Variables tab's content, once that tab is built; empty until then. */
  variables?: ReactNode
}

/**
 * The editor's right panel: Toolbar, Editor and Variables tabs over a resizable column. Every tab
 * stays mounted while hidden, as in legacy, so switching tabs keeps each one's state.
 */
export function RightPanel({ toolbarRef, variables }: RightPanelProps) {
  const panelRef = useRef<HTMLElement>(null)
  const [current, select] = useRightPanelTab()
  useEditorFollowsSelection()
  const startResize = usePanelWidth(panelRef)
  const tabRefs = useRef<Map<RightPanelTab, HTMLButtonElement> | null>(null)
  tabRefs.current ??= new Map()
  const tabNodes = tabRefs.current

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const index = TABS.findIndex((tab) => tab.id === current)
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    event.preventDefault()
    select(next.id)
    tabNodes.get(next.id)?.focus()
  }

  return (
    <aside ref={panelRef} className={styles.panel} aria-label='Workflow panel'>
      <div
        className={styles.resizer}
        role='separator'
        aria-orientation='vertical'
        aria-label='Resize panel'
        onPointerDown={startResize}
      />
      <div className={styles.tabs} role='tablist' aria-label='Panel' onKeyDown={onTabKeyDown}>
        {TABS.map((tab) => (
          <ControlRow
            key={tab.id}
            label={tab.label}
            render={
              <button
                ref={(node) => {
                  if (node) tabNodes.set(tab.id, node)
                  else tabNodes.delete(tab.id)
                }}
                type='button'
                role='tab'
                id={`workflow-panel-tab-${tab.id}`}
                aria-selected={current === tab.id}
                aria-controls={`workflow-panel-${tab.id}`}
                tabIndex={current === tab.id ? 0 : -1}
                onClick={() => select(tab.id)}
              />
            }
          />
        ))}
      </div>
      <div
        className={styles.pane}
        role='tabpanel'
        id='workflow-panel-toolbar'
        aria-labelledby='workflow-panel-tab-toolbar'
        hidden={current !== 'toolbar'}
      >
        <Toolbar ref={toolbarRef} isActive={current === 'toolbar'} />
      </div>
      <div
        className={styles.pane}
        role='tabpanel'
        id='workflow-panel-editor'
        aria-labelledby='workflow-panel-tab-editor'
        hidden={current !== 'editor'}
      >
        <EditorPanel />
      </div>
      <div
        className={styles.pane}
        role='tabpanel'
        id='workflow-panel-variables'
        aria-labelledby='workflow-panel-tab-variables'
        hidden={current !== 'variables'}
      >
        {variables}
      </div>
    </aside>
  )
}
