'use client'

import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import {
  type SuggestionKeyDownHandler,
  useSuggestionKeyboard,
} from '@/components/file-viewer/rich-markdown-editor/menus/use-suggestion-keyboard'
import type { SlashCommandItem } from '@/components/file-viewer/rich-markdown-editor/slash-commands'
import { SuggestionList } from '@/components/file-viewer/rich-markdown-editor/suggestion-list'
import type { SuggestionPlacement } from '@/components/file-viewer/rich-markdown-editor/suggestion-popup'

interface SlashCommandListProps extends SuggestionPlacement {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
  editor: Editor
}

/** The commands with each group's together, in the order the groups first appear. */
function inGroupOrder(items: SlashCommandItem[]): SlashCommandItem[] {
  const rank = new Map<string, number>()
  for (const item of items) if (!rank.has(item.group)) rank.set(item.group, rank.size)
  return [...items].sort((a, b) => (rank.get(a.group) ?? 0) - (rank.get(b.group) ?? 0))
}

/** The `/` block menu: grouped commands with their shortcuts, driven by arrow keys and Enter. */
export const SlashCommandList = forwardRef<SuggestionKeyDownHandler, SlashCommandListProps>(
  function SlashCommandList({ items, command, editor, anchor, onDismiss }, ref) {
    const ordered = useMemo(() => inGroupOrder(items), [items])
    const rows = useMemo(
      () =>
        ordered.map((item) => ({ name: item.title, group: item.group, shortcut: item.shortcut })),
      [ordered]
    )
    // The shared list scrolls its active row into view itself.
    const listRef = useRef<HTMLElement>(null)
    const { activeIndex, setActiveIndex, onKeyDown } = useSuggestionKeyboard(
      ordered,
      command,
      listRef
    )
    useImperativeHandle(ref, () => ({ onKeyDown }), [onKeyDown])

    return (
      <SuggestionList
        editor={editor}
        label='Commands'
        empty='No results'
        rows={rows}
        active={activeIndex}
        onHighlight={setActiveIndex}
        onSelect={(index) => command(ordered[index])}
        anchor={anchor}
        onDismiss={onDismiss}
      />
    )
  }
)
