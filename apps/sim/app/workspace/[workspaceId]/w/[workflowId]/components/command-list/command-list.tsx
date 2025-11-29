'use client'

import { useCallback } from 'react'
import { Layout, LibraryBig, Search } from 'lucide-react'
import Image from 'next/image'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'
import { AgentIcon } from '@/components/icons'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useSearchModalStore } from '@/stores/search-modal/store'

const logger = createLogger('WorkflowCommandList')

/**
 * Command item data structure
 */
interface CommandItem {
  /** Display label for the command */
  label: string
  /** Icon component from lucide-react */
  icon: React.ComponentType<{ className?: string }>
  /** Keyboard shortcut keys (can be single or array for multiple keys) */
  shortcut: string | string[]
}

/**
 * Available commands list
 */
const commands: CommandItem[] = [
  {
    label: 'Templates',
    icon: Layout,
    shortcut: 'Y',
  },
  {
    label: 'New Agent',
    icon: AgentIcon,
    shortcut: ['⇧', 'A'],
  },
  {
    label: 'Logs',
    icon: LibraryBig,
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
 * Centered on the screen for empty workflows
 */
export function CommandList() {
  const params = useParams()
  const router = useRouter()
  const { open: openSearchModal } = useSearchModalStore()

  const workspaceId = params.workspaceId as string | undefined

  /**
   * Handle click on a command row.
   *
   * Mirrors the behavior of the corresponding global keyboard shortcuts:
   * - Templates: navigate to workspace templates
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
          case 'Templates': {
            if (!workspaceId) {
              logger.warn('No workspace ID found, cannot navigate to templates from command list')
              return
            }
            router.push(`/workspace/${workspaceId}/templates`)
            return
          }
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
      className={cn(
        'pointer-events-none absolute inset-0 mb-[50px] flex items-center justify-center'
      )}
    >
      <div
        className='pointer-events-auto flex flex-col gap-[8px]'
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Logo */}
        <div className='mb-[20px] flex justify-center'>
          <Image
            src='/logo/b&w/text/b&w.svg'
            alt='Sim'
            width={99.56}
            height={48.56}
            className='opacity-70'
            style={{
              filter:
                'brightness(0) saturate(100%) invert(69%) sepia(0%) saturate(0%) hue-rotate(202deg) brightness(94%) contrast(89%)',
            }}
            priority
          />
        </div>

        {commands.map((command) => {
          const Icon = command.icon
          const shortcuts = Array.isArray(command.shortcut) ? command.shortcut : [command.shortcut]
          return (
            <div
              key={command.label}
              className='group flex cursor-pointer items-center justify-between gap-[60px]'
              onClick={() => handleCommandClick(command.label)}
            >
              {/* Left side: Icon and Label */}
              <div className='flex items-center gap-[8px]'>
                <Icon className='h-[14px] w-[14px] text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]' />
                <span className='font-medium text-[14px] text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]'>
                  {command.label}
                </span>
              </div>

              {/* Right side: Keyboard Shortcut */}
              <div className='flex items-center gap-[4px]'>
                <Button
                  className='group-hover:-translate-y-0.5 w-[26px] py-[3px] text-[12px] hover:translate-y-0 hover:text-[var(--text-tertiary)] hover:shadow-[0_2px_0_0_rgba(48,48,48,1)] group-hover:text-[var(--text-primary)] group-hover:shadow-[0_4px_0_0_rgba(48,48,48,1)]'
                  variant='3d'
                >
                  <span>⌘</span>
                </Button>
                {shortcuts.map((key, index) => (
                  <Button
                    key={index}
                    className='group-hover:-translate-y-0.5 w-[26px] py-[3px] text-[12px] hover:translate-y-0 hover:text-[var(--text-tertiary)] hover:shadow-[0_2px_0_0_rgba(48,48,48,1)] group-hover:text-[var(--text-primary)] group-hover:shadow-[0_4px_0_0_rgba(48,48,48,1)]'
                    variant='3d'
                  >
                    {key}
                  </Button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
