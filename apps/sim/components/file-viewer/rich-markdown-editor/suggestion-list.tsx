'use client'

import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom'
import { Icon, type IconName } from '@sim/emcn/icon'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import type { Editor } from '@tiptap/core'
import { createPortal } from 'react-dom'
import styles from '@/components/file-viewer/rich-markdown-editor/suggestion-list.module.css'
import type { SuggestionPlacement } from '@/components/file-viewer/rich-markdown-editor/suggestion-popup'

const LIST_OFFSET = 8
const LIST_PADDING = 8

interface SuggestionRow {
  name: string
  group: string
  icon?: IconName
  providerId?: string
  /** A keyboard shortcut, shown at the row's end as a menu shows one. */
  shortcut?: string
}

interface SuggestionListProps extends SuggestionPlacement {
  /** The editor keeps focus while the menu is open, so it is wired as the ARIA combobox. */
  editor: Editor
  label: string
  /** What the list says with nothing to offer; `null` while its rows are still arriving. */
  empty: string | null
  /** The rows in display order, grouped by their `group`. */
  rows: readonly SuggestionRow[]
  active: number
  onHighlight: (index: number) => void
  onSelect: (index: number) => void
}

/**
 * The `/` and `@` menus: a listbox below the suggestion's range, styled from the shared tokens and
 * portaled into the editor's EMCN surface or dialog. Focus stays in the document while the reader
 * arrows through the rows, so the editor carries the combobox attributes for the list. The file
 * viewer also renders on the public share page, outside the Platform, so the list cannot use the
 * Platform composer's suggestions.
 */
export function SuggestionList({
  editor,
  label,
  empty,
  rows,
  active,
  onHighlight,
  onSelect,
  anchor,
  onDismiss,
}: SuggestionListProps) {
  const listId = `suggestions-${useId().replace(/:/g, '')}`
  const activeId = rows.length > 0 ? `${listId}-${active}` : null
  const floatingRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges('vertical', { viewport: listRef })
  const [placed, setPlaced] = useState(false)
  const hidden = rows.length === 0 && empty === null

  useEffect(() => {
    const dom = editor.view.dom
    dom.setAttribute('aria-haspopup', 'listbox')
    dom.setAttribute('aria-expanded', 'true')
    return () => {
      dom.removeAttribute('aria-haspopup')
      dom.removeAttribute('aria-expanded')
      dom.removeAttribute('aria-controls')
      dom.removeAttribute('aria-activedescendant')
    }
  }, [editor])

  useEffect(() => {
    const dom = editor.view.dom
    if (activeId) {
      dom.setAttribute('aria-controls', listId)
      dom.setAttribute('aria-activedescendant', activeId)
    } else {
      dom.removeAttribute('aria-controls')
      dom.removeAttribute('aria-activedescendant')
    }
  }, [editor, listId, activeId])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, rows])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (floatingRef.current?.contains(target) || editor.view.dom.contains(target)) return
      onDismiss()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [editor, onDismiss])

  useLayoutEffect(() => {
    const floating = floatingRef.current
    if (!floating || hidden) return
    const reference = {
      getBoundingClientRect: () => anchor.getBoundingClientRect(),
      contextElement: editor.view.dom,
    }
    let current = true
    const cleanup = autoUpdate(reference, floating, () => {
      computePosition(reference, floating, {
        strategy: 'fixed',
        placement: 'bottom-start',
        middleware: [
          offset(LIST_OFFSET),
          flip({ padding: LIST_PADDING }),
          shift({ padding: LIST_PADDING }),
          size({
            padding: LIST_PADDING,
            apply({ availableWidth, availableHeight }) {
              floating.style.setProperty('--available-width', `${availableWidth}px`)
              floating.style.setProperty('--available-height', `${availableHeight}px`)
            },
          }),
        ],
      }).then(({ x, y }) => {
        if (!current) return
        floating.style.transform = `translate(${x}px, ${y}px)`
        setPlaced(true)
      })
    })
    return () => {
      current = false
      cleanup()
    }
  }, [anchor, editor, hidden])

  const container = editor.view.dom.closest<HTMLElement>('dialog, [data-emcn]')
  if (hidden || !container) return null
  return createPortal(
    <div
      ref={floatingRef}
      className={styles.positioner}
      data-placed={placed || undefined}
      role='presentation'
    >
      <div className={styles.popup} data-material='floating' data-elevation='menu'>
        <div ref={edges} className={styles.list} id={listId} role='listbox' aria-label={label}>
          {rows.map((row, index) => (
            <Fragment key={`${row.group}:${row.name}:${index}`}>
              {row.group !== rows[index - 1]?.group && (
                <div className={styles.heading} role='presentation' data-type='T052'>
                  {row.group}
                </div>
              )}
              <div
                role='option'
                id={`${listId}-${index}`}
                className={styles.item}
                aria-selected={active === index}
                data-highlighted={active === index ? '' : undefined}
                data-type='T060'
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => onHighlight(index)}
                onClick={() => onSelect(index)}
              >
                {row.providerId ? (
                  <Icon providerId={row.providerId} />
                ) : (
                  row.icon && <Icon name={row.icon} />
                )}
                <span className={styles.label}>{row.name}</span>
                {row.shortcut && (
                  <kbd className={styles.detail} data-type='T052'>
                    {row.shortcut}
                  </kbd>
                )}
              </div>
            </Fragment>
          ))}
          {!rows.length && (
            <div role='status' className={styles.empty} data-type='T052'>
              {empty}
            </div>
          )}
        </div>
      </div>
    </div>,
    container
  )
}
