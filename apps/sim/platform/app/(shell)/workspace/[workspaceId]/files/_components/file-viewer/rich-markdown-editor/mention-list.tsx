'use client'

import { forwardRef, useImperativeHandle, useMemo, useRef, useSyncExternalStore } from 'react'
import type { Editor } from '@tiptap/core'
import { mentionMark } from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/mention-items'
import { SuggestionList } from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/suggestion-list'
import {
  type MentionItem,
  type MentionStore,
  type SuggestionKeyDownHandler,
  useSuggestionKeyboard,
} from '@/platform/lib/data/files/markdown'

interface MentionListProps {
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
  function MentionList({ query, command, store, editor }, ref) {
    const menu = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    const containerRef = useRef<HTMLDivElement>(null)

    const { flat, groups } = useMemo(() => {
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
      const ordered: { group: string; items: { item: MentionItem; index: number }[] }[] = []
      const flat: MentionItem[] = []
      for (const group of GROUP_ORDER) {
        const inGroup = byGroup.get(group)
        if (!inGroup) continue
        ordered.push({
          group,
          items: inGroup.map((item) => ({ item, index: flat.push(item) - 1 })),
        })
      }
      return { flat, groups: ordered }
    }, [menu.items, query])

    const { activeIndex, setActiveIndex, onKeyDown } = useSuggestionKeyboard(
      flat,
      command,
      containerRef
    )
    useImperativeHandle(ref, () => ({ onKeyDown }), [onKeyDown])

    return (
      <SuggestionList
        editor={editor}
        containerRef={containerRef}
        groups={groups}
        activeIndex={activeIndex}
        setActiveIndex={setActiveIndex}
        command={command}
        ariaLabel='Mentions'
        idPrefix='mention'
        emptyLabel={menu.items.length === 0 || menu.filesPending ? null : 'No results'}
        itemKey={(item) => `${item.kind}:${item.id}`}
        itemLabel={(item) => item.label}
        itemMark={(item) => mentionMark(item.kind, item.id, item.label)}
      />
    )
  }
)
