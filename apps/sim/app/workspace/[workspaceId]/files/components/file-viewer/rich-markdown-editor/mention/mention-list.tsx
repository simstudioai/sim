import { forwardRef, useImperativeHandle, useMemo, useRef, useSyncExternalStore } from 'react'
import { SuggestionList } from '../menus/suggestion-list'
import {
  type SuggestionKeyDownHandler,
  useSuggestionKeyboard,
} from '../menus/use-suggestion-keyboard'
import type { MentionStore } from './mention-store'
import type { MentionItem } from './types'

export type MentionListHandle = SuggestionKeyDownHandler

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
  const containerRef = useRef<HTMLDivElement>(null)

  /**
   * Filtered, group-capped, flattened in category order; `index` is the flat position for nav. A single
   * pass over the full set filters by label and buckets by group (capped), then reads the buckets in
   * category order — avoiding a separate filter pass per group.
   */
  const { flat, groups } = useMemo(() => {
    const q = query.trim().toLowerCase()
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

  const { activeIndex, setActiveIndex, onKeyDown } = useSuggestionKeyboard(
    flat,
    command,
    containerRef
  )
  useImperativeHandle(ref, () => ({ onKeyDown }), [onKeyDown])

  return (
    <SuggestionList
      containerRef={containerRef}
      groups={groups}
      activeIndex={activeIndex}
      setActiveIndex={setActiveIndex}
      command={command}
      ariaLabel='Mentions'
      idPrefix='mention'
      emptyLabel={rawItems.length === 0 ? 'Loading…' : 'No results'}
      itemKey={(item) => `${item.kind}:${item.id}`}
      renderItem={(item) => {
        const Icon = item.icon
        return (
          <>
            {Icon && <Icon />}
            <span>{item.label}</span>
          </>
        )
      }}
    />
  )
})
