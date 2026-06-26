import type { ReactNode, RefObject } from 'react'
import { cn } from '@/lib/core/utils/cn'
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
  /** Scroll container ref, shared with the list's `useSuggestionKeyboard` for scroll-into-view. */
  containerRef: RefObject<HTMLDivElement | null>
  groups: SuggestionGroup<T>[]
  activeIndex: number
  setActiveIndex: (index: number) => void
  /** Inserts the chosen item (the suggestion plugin's `command`). */
  command: (item: T) => void
  ariaLabel: string
  /** Prefix for each row's element id (`${idPrefix}-${index}`). */
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
 */
export function SuggestionList<T>({
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
  if (groups.length === 0) {
    return (
      <div className={SUGGESTION_SURFACE_CLASS}>
        <p className='px-2 py-1.5 text-[var(--text-tertiary)] text-caption'>{emptyLabel}</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
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
