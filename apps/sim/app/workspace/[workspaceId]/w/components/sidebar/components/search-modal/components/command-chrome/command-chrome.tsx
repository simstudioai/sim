'use client'

import { type ComponentPropsWithoutRef, forwardRef, type KeyboardEvent } from 'react'
import { cn } from '@sim/emcn'
import { Command } from 'cmdk'
import { Search } from 'lucide-react'

type CommandInputProps = ComponentPropsWithoutRef<typeof Command.Input>
type CommandListProps = ComponentPropsWithoutRef<typeof Command.List>

interface CommandSearchProps extends Omit<CommandInputProps, 'className'> {
  surface: 'canvas' | 'palette'
  cycleResultsOnTab?: boolean
}

interface CommandFadedListProps extends CommandListProps {
  fade: 'canvas' | 'palette'
}

const SEARCH_SURFACE_CLASSNAME = {
  canvas:
    'bg-[linear-gradient(to_bottom,var(--surface-2)_0%,color-mix(in_srgb,var(--surface-2)_88%,transparent)_68%,transparent_100%)]',
  palette:
    'bg-[linear-gradient(to_bottom,var(--surface-2)_0%,color-mix(in_srgb,var(--surface-2)_88%,transparent)_68%,transparent_100%)]',
} as const

const LIST_FADE_CLASSNAME = {
  canvas:
    '[-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,transparent_8%,black_18%,black_94%,transparent_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,transparent_8%,black_18%,black_94%,transparent_100%)]',
  palette:
    '[&::-webkit-scrollbar-track]:mt-12 [&::-webkit-scrollbar-track]:mb-1.5 [-webkit-mask-composite:source-over] [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,transparent_8%,black_18%,black_94%,transparent_100%),linear-gradient(black,black)] [-webkit-mask-position:left_top,right_top] [-webkit-mask-repeat:no-repeat,no-repeat] [-webkit-mask-size:calc(100%_-_8px)_100%,8px_100%] [mask-composite:add] [mask-image:linear-gradient(to_bottom,transparent_0%,transparent_8%,black_18%,black_94%,transparent_100%),linear-gradient(black,black)] [mask-position:left_top,right_top] [mask-repeat:no-repeat,no-repeat] [mask-size:calc(100%_-_8px)_100%,8px_100%]',
} as const

/** Borderless search field layered over a fading command-result list. */
export const CommandSearch = forwardRef<HTMLInputElement, CommandSearchProps>(
  function CommandSearch({ surface, cycleResultsOnTab = false, onKeyDown, ...props }, ref) {
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
        <Search className='size-[14px] flex-shrink-0 text-[var(--text-muted)]' />
        <Command.Input
          ref={ref}
          className='h-8 min-w-0 flex-1 cursor-text bg-transparent text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)] focus:outline-none'
          onKeyDown={handleKeyDown}
          {...props}
        />
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
