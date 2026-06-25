import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { cn } from '@/lib/core/utils/cn'
import {
  SUGGESTION_GROUP_LABEL_CLASS,
  SUGGESTION_ITEM_CLASS,
  SUGGESTION_SCROLL_CLASS,
  SUGGESTION_SURFACE_CLASS,
} from '../menus/suggestion-menu-chrome'
import type { MentionStore } from './mention-store'
import type { MentionItem } from './types'

export interface MentionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface MentionListProps {
  /** The text typed after `@`, used to filter. */
  query: string
  /** Inserts the chosen mention (wired to the suggestion `command`). */
  command: (item: MentionItem) => void
  /** Live data source the host keeps populated. */
  store: MentionStore
}

/** Per-group cap so a large workspace can't flood the menu; filtering still searches the full set. */
const MAX_PER_GROUP = 8

/** Category heading order in the menu. */
const GROUP_ORDER = [
  'Files',
  'Folders',
  'Tables',
  'Knowledge bases',
  'Workflows',
  'Skills',
  'Integrations',
] as const

/**
 * The `@` mention popup. Sibling of {@link SlashCommandList} with identical chrome and arrow/enter
 * navigation, but its items come reactively from the editor's {@link MentionStore} (via
 * `useSyncExternalStore`) rather than props — so the list fills in as async workspace data lands.
 */
export const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList(
  { query, command, store },
  ref
) {
  const rawItems = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  /** Filtered, group-capped, flattened in category order; `index` is the flat position for nav. */
  const { flat, groups } = useMemo(() => {
    const q = query.trim().toLowerCase()
    // One pass over the full set: filter by label and bucket by group (capped), then read the
    // buckets in category order — avoids a separate filter pass per group.
    const byGroup = new Map<string, MentionItem[]>()
    for (const item of rawItems) {
      if (q && !item.label.toLowerCase().includes(q)) continue
      const bucket = byGroup.get(item.group)
      if (!bucket) byGroup.set(item.group, [item])
      else if (bucket.length < MAX_PER_GROUP) bucket.push(item)
    }

    const ordered: { group: string; items: { item: MentionItem; index: number }[] }[] = []
    const flat: MentionItem[] = []
    for (const group of GROUP_ORDER) {
      const inGroup = byGroup.get(group)
      if (!inGroup) continue
      ordered.push({ group, items: inGroup.map((item) => ({ item, index: flat.push(item) - 1 })) })
    }
    return { flat, groups: ordered }
  }, [rawItems, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [flat])

  useEffect(() => {
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (flat.length === 0) return false
      if (event.key === 'ArrowUp') {
        setActiveIndex((i) => (i + flat.length - 1) % flat.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setActiveIndex((i) => (i + 1) % flat.length)
        return true
      }
      if (event.key === 'Enter') {
        const item = flat[activeIndex]
        if (!item) return false
        command(item)
        return true
      }
      return false
    },
  }))

  if (flat.length === 0) {
    return (
      <div className={SUGGESTION_SURFACE_CLASS}>
        <p className='px-2 py-1.5 text-[var(--text-tertiary)] text-caption'>
          {rawItems.length === 0 ? 'Loading…' : 'No results'}
        </p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      role='listbox'
      aria-label='Mentions'
      className={cn(SUGGESTION_SURFACE_CLASS, SUGGESTION_SCROLL_CLASS)}
    >
      {groups.map((group) => (
        <div key={group.group} role='group' aria-label={group.group}>
          <p aria-hidden='true' className={SUGGESTION_GROUP_LABEL_CLASS}>
            {group.group}
          </p>
          {group.items.map(({ item, index }) => {
            const Icon = item.icon
            return (
              <button
                key={`${item.kind}:${item.id}`}
                type='button'
                role='option'
                id={`mention-${index}`}
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
                {Icon && <Icon />}
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
})
