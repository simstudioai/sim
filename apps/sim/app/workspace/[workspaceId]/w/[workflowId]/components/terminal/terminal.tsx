'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, ChevronDown, Clipboard, MoreHorizontal, RepeatIcon, SplitIcon } from 'lucide-react'
import {
  Button,
  Code,
  NoWrap,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverSection,
  PopoverTrigger,
  Tooltip,
  Wrap,
} from '@/components/emcn'
import { getBlock } from '@/blocks'
import type { ConsoleEntry } from '@/stores/terminal'
import { useTerminalConsoleStore, useTerminalStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { PrettierOutput } from './components'
import { useOutputPanelResize, useTerminalResize } from './hooks'

/**
 * Terminal height configuration constants
 */
const MIN_HEIGHT = 30
const NEAR_MIN_THRESHOLD = 40
const DEFAULT_EXPANDED_HEIGHT = 300

/**
 * Column width constants
 */
const COLUMN_WIDTHS = {
  BLOCK: 'w-[200px]',
  STATUS: 'w-[120px]',
  DURATION: 'w-[120px]',
  OUTPUT_PANEL: 'w-[400px]',
} as const

/**
 * Shared styling constants
 */
const HEADER_TEXT_CLASS = 'font-medium text-[#8D8D8D] text-[13px] dark:text-[#8D8D8D]'
const ROW_TEXT_CLASS = 'font-medium text-[#D2D2D2] text-[13px] dark:text-[#D2D2D2]'
const COLUMN_BASE_CLASS = 'flex-shrink-0'

/**
 * Retrieves the icon component for a given block type
 * @param blockType - The block type to get the icon for
 * @returns The icon component or null if not found
 */
const getBlockIcon = (blockType: string): React.ComponentType<{ className?: string }> | null => {
  const blockConfig = getBlock(blockType)

  if (blockConfig?.icon) {
    return blockConfig.icon
  }

  if (blockType === 'loop') {
    return RepeatIcon
  }

  if (blockType === 'parallel') {
    return SplitIcon
  }

  return null
}

/**
 * Formats duration from milliseconds to readable format
 */
const formatDuration = (ms?: number): string => {
  if (ms === undefined || ms === null) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/**
 * Determines if an entry should show a status badge and which type
 */
const getStatusInfo = (
  success?: boolean,
  error?: string | Error | null
): { isError: boolean; label: string } | null => {
  if (error) return { isError: true, label: 'Error' }
  if (success === undefined) return null
  return { isError: !success, label: success ? 'Info' : 'Error' }
}

/**
 * Reusable column header component
 */
const ColumnHeader = ({ label, width }: { label: string; width: string }) => (
  <span className={clsx(width, COLUMN_BASE_CLASS, HEADER_TEXT_CLASS)}>{label}</span>
)

/**
 * Reusable toggle button component
 */
const ToggleButton = ({
  isExpanded,
  onClick,
}: {
  isExpanded: boolean
  onClick: (e: React.MouseEvent) => void
}) => (
  <Button variant='ghost' className='!p-0' onClick={onClick} aria-label='Toggle terminal'>
    <ChevronDown
      className={clsx(
        'h-3.5 w-3.5 flex-shrink-0 transition-transform duration-100',
        !isExpanded && 'rotate-180'
      )}
    />
  </Button>
)

/**
 * Terminal component with resizable height that persists across page refreshes.
 *
 * Uses a CSS-based approach to prevent hydration mismatches:
 * 1. Height is controlled by CSS variable (--terminal-height)
 * 2. Blocking script in layout.tsx sets CSS variable before React hydrates
 * 3. Store updates CSS variable when height changes
 *
 * This ensures server and client render identical HTML, preventing hydration errors.
 *
 * @returns Terminal at the bottom of the workflow
 */
export function Terminal() {
  const terminalRef = useRef<HTMLElement>(null)
  const {
    terminalHeight,
    setTerminalHeight,
    outputPanelWidth,
    setOutputPanelWidth,
    displayMode,
    setDisplayMode,
    setHasHydrated,
  } = useTerminalStore()
  const entries = useTerminalConsoleStore((state) => state.entries)
  const { activeWorkflowId } = useWorkflowRegistry()
  const [selectedEntry, setSelectedEntry] = useState<ConsoleEntry | null>(null)
  const [isToggling, setIsToggling] = useState(false)
  const [displayPopoverOpen, setDisplayPopoverOpen] = useState(false)
  const [wrapText, setWrapText] = useState(true)
  const [showCopySuccess, setShowCopySuccess] = useState(false)

  // Terminal resize hooks
  const { handleMouseDown } = useTerminalResize()
  const { handleMouseDown: handleOutputPanelResizeMouseDown } = useOutputPanelResize()

  const isExpanded = terminalHeight > NEAR_MIN_THRESHOLD

  /**
   * Filter entries for current workflow
   */
  const filteredEntries = useMemo(() => {
    if (!activeWorkflowId) return []
    return entries.filter((entry) => entry.workflowId === activeWorkflowId)
  }, [entries, activeWorkflowId])

  /**
   * Handle row click - toggle if clicking same entry
   */
  const handleRowClick = useCallback((entry: ConsoleEntry) => {
    setSelectedEntry((prev) => (prev?.id === entry.id ? null : entry))
  }, [])

  /**
   * Handle header click - toggle between expanded and collapsed
   */
  const handleHeaderClick = useCallback(() => {
    setIsToggling(true)

    if (isExpanded) {
      setTerminalHeight(MIN_HEIGHT)
    } else {
      const maxHeight = window.innerHeight * 0.5
      const targetHeight = Math.min(DEFAULT_EXPANDED_HEIGHT, maxHeight)
      setTerminalHeight(targetHeight)
    }
  }, [isExpanded, setTerminalHeight])

  /**
   * Handle transition end - reset toggling state
   */
  const handleTransitionEnd = useCallback(() => {
    setIsToggling(false)
  }, [])

  /**
   * Handle copy output to clipboard
   */
  const handleCopy = useCallback(() => {
    if (!selectedEntry) return

    const dataToCopy = selectedEntry.error || selectedEntry.output
    const textToCopy = JSON.stringify(dataToCopy, null, 2)

    navigator.clipboard.writeText(textToCopy)
    setShowCopySuccess(true)
  }, [selectedEntry])

  /**
   * Mark hydration as complete on mount
   */
  useEffect(() => {
    setHasHydrated(true)
  }, [setHasHydrated])

  /**
   * Reset copy success state after 2 seconds
   */
  useEffect(() => {
    if (showCopySuccess) {
      const timer = setTimeout(() => {
        setShowCopySuccess(false)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [showCopySuccess])

  /**
   * Adjust output panel width when sidebar or panel width changes.
   * Ensures output panel doesn't exceed maximum allowed width.
   */
  useEffect(() => {
    const handleResize = () => {
      if (!selectedEntry) return

      const sidebarWidth = Number.parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width') || '0'
      )
      const panelWidth = Number.parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
      )

      // Calculate max width: total terminal width minus block column width
      const terminalWidth = window.innerWidth - sidebarWidth - panelWidth
      const maxWidth = terminalWidth - 200 // COLUMN_WIDTHS.BLOCK
      const minWidth = 300

      // If current output panel width exceeds max, clamp it
      if (outputPanelWidth > maxWidth && maxWidth >= minWidth) {
        setOutputPanelWidth(Math.max(maxWidth, minWidth))
      }
    }

    // Initial check
    handleResize()

    // Listen for window resize events
    window.addEventListener('resize', handleResize)

    // Create a MutationObserver to watch for CSS variable changes
    const observer = new MutationObserver(() => {
      handleResize()
    })

    // Observe style attribute changes on the document element
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    })

    return () => {
      window.removeEventListener('resize', handleResize)
      observer.disconnect()
    }
  }, [selectedEntry, outputPanelWidth, setOutputPanelWidth])

  return (
    <>
      {/* Resize Handle */}
      <div
        className='fixed right-[var(--panel-width)] bottom-[calc(var(--terminal-height)-4px)] left-[var(--sidebar-width)] z-20 h-[8px] cursor-ns-resize'
        onMouseDown={handleMouseDown}
        role='separator'
        aria-label='Resize terminal'
        aria-orientation='horizontal'
      />

      <aside
        ref={terminalRef}
        className={clsx(
          'terminal-container fixed right-[var(--panel-width)] bottom-0 left-[var(--sidebar-width)] z-10 overflow-hidden dark:bg-[#1E1E1E]',
          isToggling && 'transition-[height] duration-100 ease-out'
        )}
        onTransitionEnd={handleTransitionEnd}
        aria-label='Terminal'
      >
        <div className='relative flex h-full border-t dark:border-[#2C2C2C]'>
          {/* Left Section - Logs Table */}
          <div
            className={clsx('flex flex-col', !selectedEntry && 'flex-1')}
            style={selectedEntry ? { width: `calc(100% - ${outputPanelWidth}px)` } : undefined}
          >
            {/* Header */}
            <div
              className='group flex h-[30px] flex-shrink-0 cursor-pointer items-center bg-[#1E1E1E] pr-[16px] pl-[24px]'
              onClick={handleHeaderClick}
            >
              <ColumnHeader label='Block' width={COLUMN_WIDTHS.BLOCK} />
              <ColumnHeader label='Status' width={COLUMN_WIDTHS.STATUS} />
              <ColumnHeader label='Duration' width={COLUMN_WIDTHS.DURATION} />
              {!selectedEntry && (
                <div className='ml-auto flex items-center'>
                  <ToggleButton
                    isExpanded={isExpanded}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleHeaderClick()
                    }}
                  />
                </div>
              )}
            </div>

            {/* Rows */}
            <div className='flex-1 overflow-y-auto overflow-x-hidden'>
              {filteredEntries.length === 0 ? (
                <div className='flex h-full items-center justify-center text-[#8D8D8D] text-[12px]'>
                  No logs yet
                </div>
              ) : (
                filteredEntries.map((entry) => {
                  const statusInfo = getStatusInfo(entry.success, entry.error)
                  const isSelected = selectedEntry?.id === entry.id
                  const BlockIcon = getBlockIcon(entry.blockType)

                  return (
                    <div
                      key={entry.id}
                      className={clsx(
                        'flex h-[36px] cursor-pointer items-center px-[24px] hover:bg-[#2C2C2C]',
                        isSelected && 'bg-[#2C2C2C]'
                      )}
                      onClick={() => handleRowClick(entry)}
                    >
                      <div
                        className={clsx(
                          COLUMN_WIDTHS.BLOCK,
                          COLUMN_BASE_CLASS,
                          'flex items-center gap-[8px]'
                        )}
                      >
                        {BlockIcon && (
                          <BlockIcon className='h-[13px] w-[13px] flex-shrink-0 text-[#D2D2D2]' />
                        )}
                        <span className={clsx('truncate', ROW_TEXT_CLASS)}>{entry.blockName}</span>
                      </div>
                      <div className={clsx(COLUMN_WIDTHS.STATUS, COLUMN_BASE_CLASS)}>
                        {statusInfo ? (
                          <div
                            className={clsx(
                              'flex h-[24px] w-[56px] items-center justify-start rounded-[6px] border pl-[9px]',
                              statusInfo.isError
                                ? 'gap-[5px] border-[#883827] bg-[#491515]'
                                : 'gap-[8px] border-[#686868] bg-[#383838]'
                            )}
                          >
                            <div
                              className='h-[6px] w-[6px] rounded-[2px]'
                              style={{
                                backgroundColor: statusInfo.isError ? '#EF4444' : '#B7B7B7',
                              }}
                            />
                            <span
                              className='font-medium text-[12px]'
                              style={{ color: statusInfo.isError ? '#EF4444' : '#B7B7B7' }}
                            >
                              {statusInfo.label}
                            </span>
                          </div>
                        ) : (
                          <span className={ROW_TEXT_CLASS}>-</span>
                        )}
                      </div>
                      <span
                        className={clsx(
                          COLUMN_WIDTHS.DURATION,
                          COLUMN_BASE_CLASS,
                          'truncate',
                          ROW_TEXT_CLASS
                        )}
                      >
                        {formatDuration(entry.durationMs)}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Right Section - Block Output (Overlay) */}
          {selectedEntry && (
            <div
              className='absolute top-0 right-0 bottom-0 flex flex-col border-l dark:border-[#2C2C2C] dark:bg-[#1E1E1E]'
              style={{ width: `${outputPanelWidth}px` }}
            >
              {/* Horizontal Resize Handle */}
              <div
                className='-ml-[4px] absolute top-0 bottom-0 left-0 z-20 w-[8px] cursor-ew-resize'
                onMouseDown={handleOutputPanelResizeMouseDown}
                role='separator'
                aria-label='Resize output panel'
                aria-orientation='vertical'
              />

              {/* Header */}
              <div
                className='group flex h-[30px] flex-shrink-0 cursor-pointer items-center bg-[#1E1E1E] px-[16px]'
                onClick={handleHeaderClick}
              >
                <span className={HEADER_TEXT_CLASS}>Output</span>
                <div className='ml-auto flex items-center gap-[8px]'>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        variant='ghost'
                        onClick={(e) => {
                          e.stopPropagation()
                          handleCopy()
                        }}
                        aria-label='Copy output'
                        className='!p-1.5 -m-1.5'
                      >
                        {showCopySuccess ? (
                          <Check className='h-3.5 w-3.5' />
                        ) : (
                          <Clipboard className='h-3.5 w-3.5' />
                        )}
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      <span>{showCopySuccess ? 'Copied' : 'Copy output'}</span>
                    </Tooltip.Content>
                  </Tooltip.Root>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        variant='ghost'
                        onClick={(e) => {
                          e.stopPropagation()
                          setWrapText((prev) => !prev)
                        }}
                        aria-label='Toggle text wrap'
                        className='!p-1.5 -m-1.5'
                      >
                        {wrapText ? (
                          <Wrap className='h-3.5 w-3.5' />
                        ) : (
                          <NoWrap className='h-3.5 w-3.5' />
                        )}
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      <span>{wrapText ? 'Wrap text' : 'No wrap'}</span>
                    </Tooltip.Content>
                  </Tooltip.Root>
                  <Popover open={displayPopoverOpen} onOpenChange={setDisplayPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant='ghost'
                        onClick={(e) => {
                          e.stopPropagation()
                        }}
                        aria-label='Display options'
                        className='!p-1.5 -m-1.5'
                      >
                        <MoreHorizontal className='h-3.5 w-3.5' />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent side='bottom' align='end' sideOffset={4} collisionPadding={0}>
                      <PopoverSection>Display</PopoverSection>
                      <PopoverItem
                        active={displayMode === 'prettier'}
                        onClick={(e) => {
                          e.stopPropagation()
                          setDisplayMode('prettier')
                          setDisplayPopoverOpen(false)
                        }}
                      >
                        <span>Prettier</span>
                      </PopoverItem>
                      <PopoverItem
                        active={displayMode === 'raw'}
                        onClick={(e) => {
                          e.stopPropagation()
                          setDisplayMode('raw')
                          setDisplayPopoverOpen(false)
                        }}
                        className='mt-[2px]'
                      >
                        <span>Raw</span>
                      </PopoverItem>
                    </PopoverContent>
                  </Popover>
                  <ToggleButton
                    isExpanded={isExpanded}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleHeaderClick()
                    }}
                  />
                </div>
              </div>

              {/* Content */}
              <div
                className={clsx(
                  'flex-1 overflow-x-auto overflow-y-auto',
                  displayMode === 'prettier' && 'px-[8px] pb-[8px]',
                  displayMode === 'raw' && '-mt-[4px]'
                )}
              >
                {displayMode === 'raw' ? (
                  <Code.Viewer
                    code={JSON.stringify(selectedEntry.error || selectedEntry.output, null, 2)}
                    showGutter
                    language='json'
                    className='m-0 min-h-full rounded-none border-0 bg-[#1E1E1E]'
                    paddingLeft={8}
                    gutterStyle={{ backgroundColor: 'transparent' }}
                    wrapText={wrapText}
                  />
                ) : (
                  <PrettierOutput
                    output={selectedEntry.error || selectedEntry.output}
                    wrapText={wrapText}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
