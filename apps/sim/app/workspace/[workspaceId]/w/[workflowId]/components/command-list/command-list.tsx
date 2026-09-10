'use client'

import { useCallback } from 'react'
import { Button, buttonVariants, cn } from '@sim/emcn'
import { Library, Search } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { AgentIcon } from '@/components/icons'
import { WordmarkFrame } from '@/components/ui/wordmark-frame'
import { WORDMARK_MORPH_TRANSFORM, WORDMARK_PATHS } from '@/lib/branding/wordmark'
import { usePreventZoom } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useSearchModalStore } from '@/stores/modals/search/store'

const logger = createLogger('WorkflowCommandList')

/**
 * Command item data structure
 */
interface CommandItem {
  /** Display label for the command */
  label: string
  /** Icon component rendered beside the label */
  icon: React.ComponentType<{ className?: string }>
  /** Keyboard shortcut keys (can be single or array for multiple keys) */
  shortcut: string | string[]
}

/**
 * Available commands list
 */
const commands: CommandItem[] = [
  {
    label: 'New Agent',
    icon: AgentIcon,
    shortcut: ['⇧', 'A'],
  },
  {
    label: 'Logs',
    icon: Library,
    shortcut: 'L',
  },
  {
    label: 'Search Blocks',
    icon: Search,
    shortcut: 'K',
  },
]

/**
 * CommandList component that displays available commands with keyboard shortcuts
 * Centers the Sim mark in the canvas with commands below it, matching the loading mark.
 */
export function CommandList() {
  const params = useParams()
  const router = useRouter()
  const openSearchModal = useSearchModalStore((s) => s.open)
  const preventZoomRef = usePreventZoom()

  const workspaceId = params.workspaceId as string | undefined

  /**
   * Handle click on a command row.
   *
   * Mirrors the behavior of the corresponding global keyboard shortcuts:
   * - New Agent: add an agent block to the canvas
   * - Logs: navigate to workspace logs
   * - Search Blocks: open the universal search modal
   *
   * @param label - Command label that was clicked.
   */
  const handleCommandClick = useCallback(
    (label: string) => {
      try {
        switch (label) {
          case 'New Agent': {
            const event = new CustomEvent('add-block-from-toolbar', {
              detail: { type: 'agent', enableTriggerMode: false },
            })
            window.dispatchEvent(event)
            return
          }
          case 'Logs': {
            if (!workspaceId) {
              logger.warn('No workspace ID found, cannot navigate to logs from command list')
              return
            }
            router.push(`/workspace/${workspaceId}/logs`)
            return
          }
          case 'Search Blocks': {
            openSearchModal()
            return
          }
          default:
            logger.warn('Unknown command label clicked in command list', { label })
        }
      } catch (error) {
        logger.error('Failed to handle command click in command list', { error, label })
      }
    },
    [router, workspaceId, openSearchModal]
  )

  /**
   * Handle drag-over events from the toolbar.
   *
   * When a toolbar item is dragged over the command list, mark the drop as valid
   * so the browser shows the appropriate drop cursor. Only reacts to toolbar
   * drags that carry the expected JSON payload.
   *
   * @param event - Drag event from the browser.
   */
  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types.includes('application/json')) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  /**
   * Handle drops of toolbar items onto the command list.
   *
   * This forwards the drop information (block type and cursor position)
   * to the workflow canvas via a custom event. The workflow component
   * then reuses its existing drop logic to place the block precisely
   * under the cursor, including container/subflow handling.
   *
   * @param event - Drop event from the browser.
   */
  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types.includes('application/json')) {
      return
    }

    event.preventDefault()

    try {
      const raw = event.dataTransfer.getData('application/json')
      if (!raw) return

      const data = JSON.parse(raw) as { type?: string; enableTriggerMode?: boolean }
      if (!data?.type || data.type === 'connectionBlock') return

      const overlayDropEvent = new CustomEvent('toolbar-drop-on-empty-workflow-overlay', {
        detail: {
          type: data.type,
          enableTriggerMode: data.enableTriggerMode ?? false,
          clientX: event.clientX,
          clientY: event.clientY,
        },
      })

      window.dispatchEvent(overlayDropEvent)
    } catch (error) {
      logger.error('Failed to handle drop on command list', { error })
    }
  }, [])

  return (
    <div
      ref={preventZoomRef}
      className='pointer-events-none absolute inset-0 flex items-center justify-center'
    >
      <div className='pointer-events-auto relative' onDragOver={handleDragOver} onDrop={handleDrop}>
        <WordmarkFrame label='Sim'>
          <g fill='currentColor' transform={WORDMARK_MORPH_TRANSFORM}>
            {WORDMARK_PATHS.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </WordmarkFrame>

        <div className='-translate-x-1/2 absolute top-full left-1/2 flex w-max flex-col gap-2 pt-5'>
          {commands.map((command) => {
            const Icon = command.icon
            const shortcuts = Array.isArray(command.shortcut)
              ? command.shortcut
              : [command.shortcut]
            return (
              <Button
                key={command.label}
                type='button'
                variant='ghost'
                className='group justify-between gap-[60px] p-0 text-left'
                onClick={() => handleCommandClick(command.label)}
              >
                <span className='flex items-center gap-2'>
                  <Icon className='size-[14px] text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]' />
                  <span className='text-[var(--text-tertiary)] text-sm group-hover:text-[var(--text-primary)]'>
                    {command.label}
                  </span>
                </span>

                <span className='flex items-center gap-1'>
                  {['⌘', ...shortcuts].map((shortcut) => (
                    <kbd
                      key={shortcut}
                      className={cn(
                        buttonVariants({ variant: '3d' }),
                        'group-hover:-translate-y-0.5 w-[26px] py-[3px] font-sans text-caption hover-hover:translate-y-0 hover-hover:text-[var(--text-tertiary)] hover-hover:shadow-kbd-sm group-hover:text-[var(--text-primary)] group-hover:shadow-kbd'
                      )}
                    >
                      {shortcut}
                    </kbd>
                  ))}
                </span>
              </Button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
