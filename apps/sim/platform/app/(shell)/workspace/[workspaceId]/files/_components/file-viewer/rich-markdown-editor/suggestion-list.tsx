'use client'

import { type ReactNode, type RefObject, useEffect, useId } from 'react'
import { Icon, type IconName } from '@sim/emcn/icon'
import type { Editor } from '@tiptap/core'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/suggestion.module.css'

/** A labeled run of rows; `index` is each row's flat position, for keyboard navigation. */
interface SuggestionGroup<T> {
  group: string
  items: { item: T; index: number }[]
}

/** A row's leading mark: an interface glyph or a provider's brand mark. */
export type SuggestionMark = { name: IconName } | { providerId: string }

interface SuggestionListProps<T> {
  /** The editor keeps focus while the menu is open, so it is wired as the ARIA combobox. */
  editor: Editor
  containerRef: RefObject<HTMLDivElement | null>
  groups: SuggestionGroup<T>[]
  activeIndex: number
  setActiveIndex: (index: number) => void
  command: (item: T) => void
  ariaLabel: string
  idPrefix: string
  /** What the list says with nothing to offer; `null` while its rows are still arriving. */
  emptyLabel: string | null
  itemKey: (item: T) => string
  itemLabel: (item: T) => string
  itemMark?: (item: T) => SuggestionMark | undefined
  itemDetail?: (item: T) => ReactNode
}

/**
 * The grouped list the `/` and `@` menus share: the menu surface, group captions, option rows and
 * the active-row wiring. Focus stays in the document while the reader arrows through the rows, so
 * the editor carries `aria-activedescendant` for the active option.
 */
export function SuggestionList<T>({
  editor,
  containerRef,
  groups,
  activeIndex,
  setActiveIndex,
  command,
  ariaLabel,
  idPrefix,
  emptyLabel,
  itemKey,
  itemLabel,
  itemMark,
  itemDetail,
}: SuggestionListProps<T>) {
  const instanceId = useId()
  const optionIdPrefix = `${idPrefix}-${instanceId}`
  const listboxId = `${optionIdPrefix}-listbox`
  const hasOptions = groups.length > 0
  const activeOptionId = hasOptions ? `${optionIdPrefix}-${activeIndex}` : null

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
    if (activeOptionId) {
      dom.setAttribute('aria-controls', listboxId)
      dom.setAttribute('aria-activedescendant', activeOptionId)
    } else {
      dom.removeAttribute('aria-controls')
      dom.removeAttribute('aria-activedescendant')
    }
  }, [editor, listboxId, activeOptionId])

  if (!hasOptions) {
    if (emptyLabel === null) return null
    return (
      <div className={styles.panel} data-material='floating' data-elevation='menu'>
        <p role='status' className={styles.empty} data-type='T060'>
          {emptyLabel}
        </p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      id={listboxId}
      role='listbox'
      aria-label={ariaLabel}
      className={styles.panel}
      data-material='floating'
      data-elevation='menu'
    >
      {groups.map((group) => (
        <div key={group.group} role='group' aria-label={group.group} className={styles.group}>
          <p aria-hidden='true' className={styles.heading} data-type='T052'>
            {group.group}
          </p>
          {group.items.map(({ item, index }) => {
            const mark = itemMark?.(item)
            const detail = itemDetail?.(item)
            return (
              <button
                key={itemKey(item)}
                type='button'
                role='option'
                id={`${optionIdPrefix}-${index}`}
                tabIndex={-1}
                aria-selected={index === activeIndex}
                data-index={index}
                className={styles.item}
                data-type='T060'
                data-highlighted={index === activeIndex || undefined}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => command(item)}
              >
                {mark &&
                  ('name' in mark ? (
                    <Icon name={mark.name} />
                  ) : (
                    <Icon providerId={mark.providerId} />
                  ))}
                <span className={styles.label}>{itemLabel(item)}</span>
                {detail && (
                  <span className={styles.detail} data-type='T052'>
                    {detail}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
