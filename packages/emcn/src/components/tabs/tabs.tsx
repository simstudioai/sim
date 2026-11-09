'use client'

import {
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { IconButton } from '#emcn/components/button/button'
import { ControlRow } from '#emcn/components/button/control-row'
import type { IconName } from '#emcn/components/icon/icon'
import { useScrollEdges } from '#emcn/components/scroll-area/use-scroll-edges'
import styles from '#emcn/components/tabs/tabs.module.css'

export interface TabItem {
  id: string
  label: string
  icon?: IconName
  content: ReactNode
}

interface TabsProps {
  label: string
  tabs: readonly TabItem[]
  current: string
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  /**
   * Moves a tab to `index` in the strip, by dragging it or with Ctrl+Shift+Page Up/Down or
   * Alt+Shift+Left/Right on it. Absent, the tabs keep their order.
   */
  onReorder?: (id: string, index: number) => void
  renderHeader: (tabList: ReactNode) => ReactNode
}

/** Marks a drag as one of this strip's tabs, so drops elsewhere ignore it. */
const TAB_DRAG_TYPE = 'application/x-sim-tab'

const REORDER_SHORTCUTS =
  'Control+Shift+PageUp Control+Shift+PageDown Alt+Shift+ArrowLeft Alt+Shift+ArrowRight'

/** The step a reorder shortcut asks for: -1 left, 1 right, 0 not a reorder. */
function reorderStep(event: KeyboardEvent): -1 | 0 | 1 {
  if (!event.shiftKey) return 0
  if (event.ctrlKey && event.key === 'PageUp') return -1
  if (event.ctrlKey && event.key === 'PageDown') return 1
  if (event.altKey && event.key === 'ArrowLeft') return -1
  if (event.altKey && event.key === 'ArrowRight') return 1
  return 0
}

/** Where a dragged tab lands for the gap the pointer is in, as an index once it leaves its own. */
function dropIndex(from: number, gap: number): number | null {
  if (from < 0) return null
  const target = gap > from ? gap - 1 : gap
  return target === from ? null : target
}

export function Tabs({
  label,
  tabs,
  current,
  onSelect,
  onRemove,
  onReorder,
  renderHeader,
}: TabsProps) {
  const scrollRef = useScrollEdges<HTMLDivElement>('horizontal')
  const listRef = useRef<HTMLDivElement>(null)
  const selected = useRef<HTMLButtonElement>(null)
  const [dragged, setDragged] = useState<string | null>(null)
  /** The gap between tabs the dragged one would drop into, from 0 to the tab count. */
  const [gap, setGap] = useState<number | null>(null)
  /** Set by a keyboard move: the moved tab keeps focus once the strip renders its new order. */
  const refocus = useRef(false)
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    selected.current?.focus()
  })
  const from = tabs.findIndex((tab) => tab.id === dragged)
  const target = gap === null ? null : dropIndex(from, gap)
  function closeTab(id: string) {
    onRemove(id)
    if (tabs.length > 1) requestAnimationFrame(() => selected.current?.focus())
  }
  function endDrag() {
    setDragged(null)
    setGap(null)
  }
  function gapAt(clientX: number) {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])
    const index = buttons.findIndex((button) => {
      const rect = button.getBoundingClientRect()
      return clientX < rect.left + rect.width / 2
    })
    return index < 0 ? buttons.length : index
  }
  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!dragged || !event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return
    event.preventDefault()
    const next = gapAt(event.clientX)
    event.dataTransfer.dropEffect = dropIndex(from, next) === null ? 'none' : 'move'
    setGap(next)
  }
  function onDrop(event: DragEvent<HTMLDivElement>) {
    if (!dragged || !event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return
    event.preventDefault()
    const index = dropIndex(from, gapAt(event.clientX))
    if (index !== null) onReorder?.(dragged, index)
    endDrag()
  }
  function dropMark(index: number) {
    if (target === null) return undefined
    if (gap === index) return 'before'
    if (gap === tabs.length && index === tabs.length - 1) return 'after'
    return undefined
  }
  return (
    <BaseTabs.Root
      className={styles.root}
      value={current}
      onValueChange={(value) => {
        if (typeof value === 'string') onSelect(value)
      }}
    >
      {renderHeader(
        <div ref={scrollRef} className={styles.strip}>
          <BaseTabs.List
            ref={listRef}
            className={styles.tabs}
            aria-label={label}
            activateOnFocus
            onDragOver={onReorder && onDragOver}
            onDrop={onReorder && onDrop}
            onDragLeave={(event) => {
              const into = event.relatedTarget
              if (!(into instanceof Node) || !event.currentTarget.contains(into)) setGap(null)
            }}
          >
            {tabs.map((tab, index) => (
              <ControlRow
                key={tab.id}
                label={tab.label}
                icon={tab.icon}
                render={
                  <BaseTabs.Tab
                    value={tab.id}
                    ref={tab.id === current ? selected : undefined}
                    draggable={onReorder ? true : undefined}
                    aria-keyshortcuts={onReorder ? REORDER_SHORTCUTS : undefined}
                    data-dragging={dragged === tab.id || undefined}
                    data-drop={dropMark(index)}
                    onDragStart={(event) => {
                      if (!onReorder) return
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData(TAB_DRAG_TYPE, tab.id)
                      setDragged(tab.id)
                    }}
                    onDragEnd={endDrag}
                    onKeyDown={(event) => {
                      if (event.key === 'Delete') {
                        event.preventDefault()
                        closeTab(tab.id)
                        return
                      }
                      const step = onReorder ? reorderStep(event) : 0
                      if (!step) return
                      event.preventDefault()
                      event.stopPropagation()
                      const next = index + step
                      if (next < 0 || next >= tabs.length) return
                      refocus.current = true
                      onReorder?.(tab.id, next)
                    }}
                  />
                }
                action={
                  <IconButton
                    icon='I105'
                    size='compact'
                    label={`Close ${tab.label} tab`}
                    onClick={() => closeTab(tab.id)}
                  />
                }
              />
            ))}
          </BaseTabs.List>
        </div>
      )}
      {tabs.map((tab) => (
        <BaseTabs.Panel key={tab.id} value={tab.id} keepMounted className={styles.pane}>
          {tab.content}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  )
}
