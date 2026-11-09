'use client'

import { useCallback } from 'react'
import { Icon, type IconName } from '@sim/emcn/icon'
import { useRouter } from 'next/navigation'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/command-list/command-list.module.css'
import {
  createLogger,
  usePreventZoom,
  useSearchModalStore,
  useWorkflowScope,
} from '@/platform/lib/data/workflows'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'

const logger = createLogger('WorkflowCommandList')

/**
 * Command item data structure
 */
interface CommandItem {
  /** Display label for the command */
  label: string
  /** Glyph rendered beside the label */
  icon: IconName
  /** Keyboard shortcut keys (can be single or array for multiple keys) */
  shortcut: string | string[]
}

/**
 * Available commands list
 */
const commands: CommandItem[] = [
  {
    label: 'New Agent',
    icon: 'I128',
    shortcut: ['⇧', 'A'],
  },
  {
    label: 'Logs',
    icon: 'I082',
    shortcut: 'L',
  },
  {
    label: 'Search Blocks',
    icon: 'I089',
    shortcut: 'K',
  },
]

/**
 * The commands an empty workflow offers, with their keyboard shortcuts, centered on the canvas. A
 * toolbar block dropped on the list lands on the canvas under the cursor.
 */
export function CommandList() {
  const { workspaceId } = useWorkflowScope()
  const router = useRouter()
  const openSearchModal = useSearchModalStore((s) => s.open)
  const preventZoomRef = usePreventZoom()

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
            /* Read at click time: a `useSearchParams` read would suspend the canvas overlay. */
            router.push(
              platformHref(
                workspacePath(workspaceId, 'logs'),
                new URLSearchParams(window.location.search)
              )
            )
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
    <div ref={preventZoomRef} className={styles.overlay}>
      <div className={styles.list} onDragOver={handleDragOver} onDrop={handleDrop}>
        <span className={styles.logo}>
          <Icon name='I113' label='Sim' />
        </span>

        {commands.map((command) => {
          const shortcuts = Array.isArray(command.shortcut) ? command.shortcut : [command.shortcut]
          return (
            <button
              key={command.label}
              type='button'
              className={styles.command}
              onClick={() => handleCommandClick(command.label)}
            >
              <span className={styles.label}>
                <Icon name={command.icon} />
                <span data-type='T067'>{command.label}</span>
              </span>

              <span className={styles.keys}>
                <kbd className={styles.key} data-type='T001' data-elevation='control'>
                  ⌘
                </kbd>
                {shortcuts.map((shortcut) => (
                  <kbd
                    key={shortcut}
                    className={styles.key}
                    data-type='T001'
                    data-elevation='control'
                  >
                    {shortcut}
                  </kbd>
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
