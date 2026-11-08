'use client'

import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import type { SlashCommandItem } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/rich-markdown-editor/slash-commands'
import { SuggestionList } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/rich-markdown-editor/suggestion-list'
import {
  type SuggestionKeyDownHandler,
  useSuggestionKeyboard,
} from '@/platform/lib/data/files/markdown'

interface SlashCommandListProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
  editor: Editor
}

/** The `/` block menu: grouped commands with their shortcuts, driven by arrow keys and Enter. */
export const SlashCommandList = forwardRef<SuggestionKeyDownHandler, SlashCommandListProps>(
  function SlashCommandList({ items, command, editor }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const { activeIndex, setActiveIndex, onKeyDown } = useSuggestionKeyboard(
      items,
      command,
      containerRef
    )
    useImperativeHandle(ref, () => ({ onKeyDown }), [onKeyDown])

    const groups = useMemo(() => {
      const ordered: { group: string; items: { item: SlashCommandItem; index: number }[] }[] = []
      const byGroup = new Map<string, (typeof ordered)[number]>()
      items.forEach((item, index) => {
        const bucket = byGroup.get(item.group)
        if (bucket) bucket.items.push({ item, index })
        else {
          const next = { group: item.group, items: [{ item, index }] }
          byGroup.set(item.group, next)
          ordered.push(next)
        }
      })
      return ordered
    }, [items])

    return (
      <SuggestionList
        editor={editor}
        containerRef={containerRef}
        groups={groups}
        activeIndex={activeIndex}
        setActiveIndex={setActiveIndex}
        command={command}
        ariaLabel='Commands'
        idPrefix='slash-command'
        emptyLabel='No results'
        itemKey={(item) => item.title}
        itemLabel={(item) => item.title}
        itemDetail={(item) => item.shortcut}
      />
    )
  }
)
