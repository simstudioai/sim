import { type ReactNode, type RefObject, useEffect } from 'react'
import { cn } from '@sim/emcn'
import type { Editor } from '@tiptap/core'
import {
  SUGGESTION_GROUP_LABEL_CLASS,
  SUGGESTION_ITEM_CLASS,
  SUGGESTION_SCROLL_CLASS,
  SUGGESTION_SURFACE_CLASS,
} from './suggestion-menu-chrome'

/** A labeled run of items; `index` is each item's flat position, used for keyboard nav + scroll. */
export interface SuggestionGroup<T> {
  group: string
  items: { item: T; index: number }[]
}

interface SuggestionListProps<T> {
  /** The editor whose contenteditable keeps focus while the menu is open — wired as the ARIA combobox. */
  editor: Editor
  /** Scroll container ref, shared with the list's `useSuggestionKeyboard` for scroll-into-view. */
  containerRef: RefObject<HTMLDivElement | null>
  groups: SuggestionGroup<T>[]
  activeIndex: number
  setActiveIndex: (index: number) => void
  /** Inserts the chosen item (the suggestion plugin's `command`). */
  command: (item: T) => void
  ariaLabel: string
  /** Prefix for each row's element id (`${idPrefix}-${index}`) and the listbox id. */
  idPrefix: string
  /** Shown in place of the list when there are no groups (e.g. "No results" / "Loading…"). */
  emptyLabel: string
  itemKey: (item: T) => string
  renderItem: (item: T) => ReactNode
}

/**
 * The shared grouped-list shell for the `/` and `@` suggestion menus: the bordered surface, the empty
 * state, the `role="listbox"` → `role="group"` → option-button structure, and the active-row / hover /
 * mousedown-select wiring. Each menu computes its own `groups` and supplies `itemKey`/`renderItem`;
 * everything else (chrome, a11y, navigation hooks) lives here so the two menus stay identical.
 *
 * Accessibility: focus stays in the editor's contenteditable while the user arrows the menu, so the
 * editor is wired as the combobox — it gets `aria-haspopup`/`aria-expanded`/`aria-controls` and an
 * `aria-activedescendant` pointing at the active option's id, the standard pattern for announcing the
 * active row without moving focus. The attributes are removed when the menu closes (unmount).
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
  renderItem,
}: SuggestionListProps<T>) {
  const listboxId = `${idPrefix}-listbox`
  const hasOptions = groups.length > 0
  const activeOptionId = hasOptions ? `${idPrefix}-${activeIndex}` : null

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
    return (
      <div className={SUGGESTION_SURFACE_CLASS}>
        <p role='status' className='px-2 py-1.5 text-[var(--text-tertiary)] text-caption'>
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
      className={cn(SUGGESTION_SURFACE_CLASS, SUGGESTION_SCROLL_CLASS)}
    >
      {groups.map((group) => (
        <div key={group.group} role='group' aria-label={group.group}>
          <p aria-hidden='true' className={SUGGESTION_GROUP_LABEL_CLASS}>
            {group.group}
          </p>
          {group.items.map(({ item, index }) => (
            <button
              key={itemKey(item)}
              type='button'
              role='option'
              id={`${idPrefix}-${index}`}
              aria-selected={index === activeIndex}
              data-index={index}
              className={cn(
                SUGGESTION_ITEM_CLASS,
                index === activeIndex && 'bg-[var(--surface-active)]'
              )}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault()
                command(item)
              }}
            >
              {renderItem(item)}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
