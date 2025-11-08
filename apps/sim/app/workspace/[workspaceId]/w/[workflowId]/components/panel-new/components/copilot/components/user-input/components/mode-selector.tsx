'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Package } from 'lucide-react'
import {
  Badge,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  Tooltip,
} from '@/components/emcn'
import { cn } from '@/lib/utils'

interface ModeSelectorProps {
  /** Current mode - 'ask' or 'build' */
  mode: 'ask' | 'build'
  /** Callback when mode changes */
  onModeChange?: (mode: 'ask' | 'build') => void
  /** Whether the input is near the top of viewport (affects dropdown direction) */
  isNearTop: boolean
  /** Whether the selector is disabled */
  disabled?: boolean
}

/**
 * Mode selector dropdown for switching between Ask and Build modes.
 * Displays appropriate icon and label, with tooltips explaining each mode.
 *
 * @param props - Component props
 * @returns Rendered mode selector dropdown
 */
export function ModeSelector({ mode, onModeChange, isNearTop, disabled }: ModeSelectorProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const getModeIcon = () => {
    if (mode === 'ask') {
      return <MessageSquare className='h-3 w-3' />
    }
    return <Package className='h-3 w-3' />
  }

  const getModeText = () => {
    if (mode === 'ask') {
      return 'Ask'
    }
    return 'Build'
  }

  const handleSelect = (selectedMode: 'ask' | 'build') => {
    onModeChange?.(selectedMode)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return

    const handleClickOutside = (event: MouseEvent) => {
      // Keep popover open while resizing the panel (mousedown on resize handle)
      const target = event.target as Element | null
      if (
        target &&
        (target.closest('[aria-label="Resize panel"]') ||
          target.closest('[role="separator"]') ||
          target.closest('.cursor-ew-resize'))
      ) {
        return
      }

      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <Popover open={open} variant='default'>
      <PopoverAnchor asChild>
        <div ref={triggerRef}>
          <Badge
            variant='outline'
            className={cn(
              'cursor-pointer rounded-[6px]',
              (disabled || !onModeChange) && 'cursor-not-allowed opacity-50'
            )}
            aria-expanded={open}
            onMouseDown={(e) => {
              if (disabled || !onModeChange) {
                e.preventDefault()
                return
              }
              e.stopPropagation()
              setOpen((prev) => !prev)
            }}
          >
            {getModeIcon()}
            <span>{getModeText()}</span>
          </Badge>
        </div>
      </PopoverAnchor>
      <PopoverContent
        ref={popoverRef}
        side={isNearTop ? 'bottom' : 'top'}
        align='start'
        sideOffset={4}
        className='w-[160px]'
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <PopoverScrollArea className='space-y-[2px]'>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <PopoverItem active={mode === 'ask'} onClick={() => handleSelect('ask')}>
                <MessageSquare className='h-3.5 w-3.5' />
                <span>Ask</span>
              </PopoverItem>
            </Tooltip.Trigger>
            <Tooltip.Content
              side='right'
              sideOffset={6}
              align='center'
              className='max-w-[220px] border bg-popover p-2 text-[11px] text-popover-foreground leading-snug shadow-md'
            >
              Ask mode can help answer questions about your workflow, tell you about Sim, and guide
              you in building/editing.
            </Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <PopoverItem active={mode === 'build'} onClick={() => handleSelect('build')}>
                <Package className='h-3.5 w-3.5' />
                <span>Build</span>
              </PopoverItem>
            </Tooltip.Trigger>
            <Tooltip.Content
              side='right'
              sideOffset={6}
              align='center'
              className='max-w-[220px] border bg-popover p-2 text-[11px] text-popover-foreground leading-snug shadow-md'
            >
              Build mode can build, edit, and interact with your workflows (Recommended)
            </Tooltip.Content>
          </Tooltip.Root>
        </PopoverScrollArea>
      </PopoverContent>
    </Popover>
  )
}
