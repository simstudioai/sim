'use client'

import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { cn } from '@sim/emcn'
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

interface CommandFadedListProps extends CommandListProps {
  fade: 'canvas' | 'palette'
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
 * The palette hides its scrollbar (`scrollbar-none` at the call site), so it
 * fades with one plain mask; its band is kept short — fully masked only under
 * the floating input (0–36px), legible by 58px, and a brief 13px exit — so
 * rows spend less time in the fog than on the canvas surface. The palette's
 * stops are anchored in pixels (the 448px max-height look frozen) because the
 * list shrinks to its content: percentage stops would move the fog on every
 * result-count change, a shimmer the dark selected first row makes obvious.
 * The canvas list fills a fixed-height card, so its percentage stops never
 * move.
 */
const LIST_FADE_CLASSNAME = {
  canvas:
    '[-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,transparent_8%,black_18%,black_94%,transparent_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,transparent_8%,black_18%,black_94%,transparent_100%)]',
  palette:
    '[-webkit-mask-image:linear-gradient(to_bottom,transparent_0px,transparent_36px,black_58px,black_calc(100%_-_13px),transparent_100%)] [mask-image:linear-gradient(to_bottom,transparent_0px,transparent_36px,black_58px,black_calc(100%_-_13px),transparent_100%)]',
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

/** Scrollable command list with soft edge fades tuned for each command surface. */
export const CommandFadedList = forwardRef<HTMLDivElement, CommandFadedListProps>(
  function CommandFadedList({ className, fade, ...props }, ref) {
    return (
      <Command.List
        ref={ref}
        className={cn(
          'overflow-y-auto overflow-x-hidden px-1.5 pt-12 pb-1.5 [&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-col',
          LIST_FADE_CLASSNAME[fade],
          className
        )}
        {...props}
      />
    )
  }
)

CommandFadedList.displayName = 'CommandFadedList'
