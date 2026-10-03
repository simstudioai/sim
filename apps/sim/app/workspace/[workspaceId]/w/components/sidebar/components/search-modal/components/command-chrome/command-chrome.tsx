'use client'

import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useRef,
} from 'react'
import { cn, scrollFadeAttributes, scrollFadeClass, useScrollEdges } from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import { Command } from 'cmdk'

type CommandInputProps = ComponentPropsWithoutRef<typeof Command.Input>
type CommandListProps = ComponentPropsWithoutRef<typeof Command.List>

interface CommandSearchProps extends Omit<CommandInputProps, 'className'> {
  surface: 'canvas' | 'palette'
  cycleResultsOnTab?: boolean
  /** Trailing slot after the input (e.g. a mode hint). Non-interactive. */
  endAdornment?: ReactNode
}

/**
 * The fog must repaint its host's exact background or it reads as a tinted
 * band under the input: the canvas selector card fills with `--surface-2`,
 * while the palette's rows sit on the inner `--bg` panel (the dialog's
 * surface-4/5 is only the 3px ring around it).
 */
const SEARCH_SURFACE_CLASSNAME = {
  canvas:
    'bg-[linear-gradient(to_bottom,var(--surface-2)_0%,color-mix(in_srgb,var(--surface-2)_88%,transparent)_68%,transparent_100%)]',
  palette:
    'bg-[linear-gradient(to_bottom,var(--bg)_0%,color-mix(in_srgb,var(--bg)_88%,transparent)_68%,transparent_100%)]',
} as const

/**
 * Borderless search field layered over a fading command-result list.
 *
 * The matching indent and negative margin give leading glyphs room inside
 * Chrome's input clip edge without moving the text out of alignment.
 */
export const CommandSearch = forwardRef<HTMLInputElement, CommandSearchProps>(
  function CommandSearch(
    { surface, cycleResultsOnTab = false, endAdornment, onKeyDown, ...props },
    ref
  ) {
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(event)
      if (!cycleResultsOnTab || event.defaultPrevented || event.key !== 'Tab') return

      event.preventDefault()
      event.currentTarget.dispatchEvent(
        new window.KeyboardEvent('keydown', {
          key: event.shiftKey ? 'ArrowUp' : 'ArrowDown',
          bubbles: true,
          cancelable: true,
        })
      )
    }

    return (
      <div
        className={cn(
          'nodrag nopan absolute inset-x-[3px] top-[3px] z-20 flex h-12 cursor-text items-center gap-2 rounded-t-[13px] px-2.5 pb-2',
          SEARCH_SURFACE_CLASSNAME[surface]
        )}
      >
        <Search className='size-[14px] shrink-0 text-[var(--text-muted)]' />
        <Command.Input
          ref={ref}
          className='-ml-1 h-8 min-w-0 flex-1 cursor-text bg-transparent indent-1 text-[var(--text-body)] text-sm outline-hidden placeholder:text-[var(--text-muted)] focus:outline-hidden'
          onKeyDown={handleKeyDown}
          {...props}
        />
        {endAdornment}
      </div>
    )
  }
)

CommandSearch.displayName = 'CommandSearch'

/**
 * Scrollable command list with the shared edge fade. The search field floats over
 * the list's top 48px (`pt-12` keeps the first row clear of it), so the top band
 * is inset by that height: while scrolled, rows are fully hidden under the field
 * and fade in just beneath it. At rest neither edge fades, so the first group's
 * heading and the last row are never fogged on a list that has not moved.
 */
export const CommandFadedList = forwardRef<HTMLDivElement, CommandListProps>(
  function CommandFadedList({ className, ...props }, ref) {
    const listRef = useRef<HTMLDivElement | null>(null)
    const edges = useScrollEdges(listRef)

    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        listRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      },
      [ref]
    )

    return (
      <Command.List
        ref={setRefs}
        className={cn(
          'overflow-y-auto overflow-x-hidden px-1.5 pt-12 pb-1.5 [--scroll-fade-inset:3rem] [&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-col',
          scrollFadeClass,
          className
        )}
        {...scrollFadeAttributes(edges)}
        {...props}
      />
    )
  }
)

CommandFadedList.displayName = 'CommandFadedList'
