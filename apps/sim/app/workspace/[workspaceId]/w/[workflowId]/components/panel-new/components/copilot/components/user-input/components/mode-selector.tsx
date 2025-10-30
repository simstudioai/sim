'use client'

import { Bot, Check, MessageSquare } from 'lucide-react'
import { Badge, Tooltip } from '@/components/emcn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui'
import { cn } from '@/lib/utils'

interface ModeSelectorProps {
  /** Current mode - 'ask' or 'agent' */
  mode: 'ask' | 'agent'
  /** Callback when mode changes */
  onModeChange?: (mode: 'ask' | 'agent') => void
  /** Whether the input is near the top of viewport (affects dropdown direction) */
  isNearTop: boolean
  /** Whether the selector is disabled */
  disabled?: boolean
}

/**
 * Mode selector dropdown for switching between Ask and Agent modes.
 * Displays appropriate icon and label, with tooltips explaining each mode.
 *
 * @param props - Component props
 * @returns Rendered mode selector dropdown
 */
export function ModeSelector({ mode, onModeChange, isNearTop, disabled }: ModeSelectorProps) {
  const getModeIcon = () => {
    if (mode === 'ask') {
      return <MessageSquare className='h-3 w-3' />
    }
    return <Bot className='h-3 w-3' />
  }

  const getModeText = () => {
    if (mode === 'ask') {
      return 'Ask'
    }
    return 'Agent'
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Badge
          variant='outline'
          className={cn(
            'cursor-pointer rounded-[6px]',
            (disabled || !onModeChange) && 'cursor-not-allowed opacity-50'
          )}
          onClick={(e) => {
            if (disabled || !onModeChange) {
              e.preventDefault()
            }
          }}
        >
          {getModeIcon()}
          <span>{getModeText()}</span>
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' side={isNearTop ? 'bottom' : 'top'} className='p-0'>
        <div className='w-[160px] p-1'>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <DropdownMenuItem
                onSelect={() => onModeChange?.('ask')}
                className={cn(
                  'flex items-center justify-between rounded-sm px-2 py-1.5 text-xs leading-4',
                  mode === 'ask' && 'bg-muted/40'
                )}
              >
                <span className='flex items-center gap-1.5'>
                  <MessageSquare className='h-3 w-3 text-muted-foreground' />
                  Ask
                </span>
                {mode === 'ask' && <Check className='h-3 w-3 text-muted-foreground' />}
              </DropdownMenuItem>
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
              <DropdownMenuItem
                onSelect={() => onModeChange?.('agent')}
                className={cn(
                  'flex items-center justify-between rounded-sm px-2 py-1.5 text-xs leading-4',
                  mode === 'agent' && 'bg-muted/40'
                )}
              >
                <span className='flex items-center gap-1.5'>
                  <Bot className='h-3 w-3 text-muted-foreground' />
                  Agent
                </span>
                {mode === 'agent' && <Check className='h-3 w-3 text-muted-foreground' />}
              </DropdownMenuItem>
            </Tooltip.Trigger>
            <Tooltip.Content
              side='right'
              sideOffset={6}
              align='center'
              className='max-w-[220px] border bg-popover p-2 text-[11px] text-popover-foreground leading-snug shadow-md'
            >
              Agent mode can build, edit, and interact with your workflows (Recommended)
            </Tooltip.Content>
          </Tooltip.Root>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
