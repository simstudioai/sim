import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { SuggestionList } from '../menus/suggestion-list'
import {
  type SuggestionKeyDownHandler,
  useSuggestionKeyboard,
} from '../menus/use-suggestion-keyboard'
import type { SlashCommandItem } from './commands'

export type SlashCommandListHandle = SuggestionKeyDownHandler

interface SlashCommandListProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
}

/**
 * The `/` command popup. Mirrors the Chat composer's skills menu — same item chrome,
 * grouped headings, and arrow/enter keyboard navigation — so the two feel identical.
 * Exposes an imperative `onKeyDown` driven by the TipTap suggestion plugin.
 */
export const SlashCommandList = forwardRef<SlashCommandListHandle, SlashCommandListProps>(
  function SlashCommandList({ items, command }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const { activeIndex, setActiveIndex, onKeyDown } = useSuggestionKeyboard(
      items,
      command,
      containerRef
    )
    useImperativeHandle(ref, () => ({ onKeyDown }), [onKeyDown])

    const groups = useMemo(() => {
      const ordered: { group: string; items: { item: SlashCommandItem; index: number }[] }[] = []
      items.forEach((item, index) => {
        const bucket = ordered.find((g) => g.group === item.group)
        if (bucket) bucket.items.push({ item, index })
        else ordered.push({ group: item.group, items: [{ item, index }] })
      })
      return ordered
    }, [items])

    return (
      <SuggestionList
        containerRef={containerRef}
        groups={groups}
        activeIndex={activeIndex}
        setActiveIndex={setActiveIndex}
        command={command}
        ariaLabel='Commands'
        idPrefix='slash-command'
        emptyLabel='No results'
        itemKey={(item) => item.title}
        renderItem={(item) => {
          const Icon = item.icon
          return (
            <>
              <Icon />
              <span>{item.title}</span>
              {item.shortcut && (
                <span className='ml-auto shrink-0 pl-4 text-[var(--text-subtle)] text-micro'>
                  {item.shortcut}
                </span>
              )}
            </>
          )
        }}
      />
    )
  }
)
