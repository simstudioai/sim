'use client'

import { forwardRef, useImperativeHandle, useMemo, useRef, useSyncExternalStore } from 'react'
import type { Editor } from '@tiptap/core'
import { mentionMark } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/mention-items'
import { SuggestionList } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/suggestion-list'
import type { SuggestionPlacement } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/suggestion-popup'
import {
  type MentionItem,
  type MentionStore,
  type SuggestionKeyDownHandler,
  useSuggestionKeyboard,
} from '@/platform/lib/data/files/markdown'

interface MentionListProps extends SuggestionPlacement {
  /** The text typed after `@`. */
  query: string
  command: (item: MentionItem) => void
  store: MentionStore
  editor: Editor
}

/** Each group's cap while unfiltered, so a large workspace cannot flood the menu. */
const MAX_PER_GROUP = 8
/** The total cap while filtering, which reaches deep matches but bounds the list. */
const MAX_WHEN_FILTERED = 50

const GROUP_ORDER = [
  'Files',
  'Folders',
  'Tables',
  'Knowledge bases',
  'Workflows',
  'Skills',
  'Integrations',
] as const

function matches(item: MentionItem, query: string): boolean {
  return item.matchedQuery?.toLowerCase() === query || item.label.toLowerCase().includes(query)
}

/**
 * The `@` mention menu. Its rows come from the editor's store rather than props, so it fills in as
 * the workspace's entities arrive; with nothing to show yet it says so only once files settle.
 */
export const MentionList = forwardRef<SuggestionKeyDownHandler, MentionListProps>(
  function MentionList({ query, command, store, editor, anchor, onDismiss }, ref) {
    const menu = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    // The shared list scrolls its active row into view itself.
    const listRef = useRef<HTMLElement>(null)

    const flat = useMemo(() => {
      const q = query.trim().toLowerCase()
      const byGroup = new Map<string, MentionItem[]>()
      let shown = 0
      for (const item of menu.items) {
        if (q && !matches(item, q)) continue
        if (q && shown >= MAX_WHEN_FILTERED) break
        const bucket = byGroup.get(item.group)
        if (!q && bucket && bucket.length >= MAX_PER_GROUP) continue
        if (bucket) bucket.push(item)
        else byGroup.set(item.group, [item])
        shown++
      }
      return GROUP_ORDER.flatMap((group) => byGroup.get(group) ?? [])
    }, [menu.items, query])

    const rows = useMemo(
      () =>
        flat.map((item) => {
          const mark = mentionMark(item.kind, item.id, item.label)
          return {
            name: item.label,
            group: item.group,
            ...(mark && ('name' in mark ? { icon: mark.name } : { providerId: mark.providerId })),
          }
        }),
      [flat]
    )

    const { activeIndex, setActiveIndex, onKeyDown } = useSuggestionKeyboard(flat, command, listRef)
    useImperativeHandle(ref, () => ({ onKeyDown }), [onKeyDown])

    return (
      <SuggestionList
        editor={editor}
        label='Mentions'
        empty={menu.items.length === 0 || menu.filesPending ? null : 'No results'}
        rows={rows}
        active={activeIndex}
        onHighlight={setActiveIndex}
        onSelect={(index) => command(flat[index])}
        anchor={anchor}
        onDismiss={onDismiss}
      />
    )
  }
)
