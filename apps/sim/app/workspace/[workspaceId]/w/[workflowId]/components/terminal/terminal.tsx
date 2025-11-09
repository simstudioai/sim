'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Check,
  ChevronDown,
  Clipboard,
  MoreHorizontal,
  RepeatIcon,
  SplitIcon,
  Trash2,
} from 'lucide-react'
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
 * Column width constants - numeric values for calculations
 */
const BLOCK_COLUMN_WIDTH_PX = 240
const MIN_OUTPUT_PANEL_WIDTH_PX = 300

/**
 * Column width constants - Tailwind classes for styling
 */
const COLUMN_WIDTHS = {
  BLOCK: 'w-[240px]',
  STATUS: 'w-[120px]',
  DURATION: 'w-[120px]',
  RUN_ID: 'w-[120px]',
  TIMESTAMP: 'w-[120px]',
  OUTPUT_PANEL: 'w-[400px]',
} as const

/**
 * Color palette for run IDs - matching code syntax highlighting colors
 */
const RUN_ID_COLORS = [
  { text: '#4ADE80' }, // Green
  { text: '#F472B6' }, // Pink
  { text: '#60C5FF' }, // Blue
  { text: '#FF8533' }, // Orange
  { text: '#C084FC' }, // Purple
  { text: '#FCD34D' }, // Yellow
] as const

/**
 * Shared styling constants
 */
const HEADER_TEXT_CLASS = 'font-medium text-[#AEAEAE] text-[12px] dark:text-[#AEAEAE]'
const ROW_TEXT_CLASS = 'font-medium text-[#D2D2D2] text-[12px] dark:text-[#D2D2D2]'
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
 * Formats timestamp to H:MM:SS AM/PM TZ format
 */
const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp)
  const fullString = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  })
  // Format: "5:54:55 PM PST" - return as is
  return fullString
}

/**
 * Truncates execution ID for display as run ID
 */
const formatRunId = (executionId?: string): string => {
  if (!executionId) return '-'
  return executionId.slice(0, 8)
}

/**
 * Gets color for a run ID based on its index in the execution ID order map
 */
const getRunIdColor = (
  executionId: string | undefined,
  executionIdOrderMap: Map<string, number>
) => {
  if (!executionId) return null
  const colorIndex = executionIdOrderMap.get(executionId)
  if (colorIndex === undefined) return null
  return RUN_ID_COLORS[colorIndex % RUN_ID_COLORS.length]
}

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
  const clearWorkflowConsole = useTerminalConsoleStore((state) => state.clearWorkflowConsole)
  const { activeWorkflowId } = useWorkflowRegistry()
  const [selectedEntry, setSelectedEntry] = useState<ConsoleEntry | null>(null)
  const [isToggling, setIsToggling] = useState(false)
  const [displayPopoverOpen, setDisplayPopoverOpen] = useState(false)
  const [wrapText, setWrapText] = useState(true)
  const [showCopySuccess, setShowCopySuccess] = useState(false)
  const [showInput, setShowInput] = useState(false)

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
   * Create stable execution ID to color index mapping based on order of first appearance.
   * Once an execution ID is assigned a color index, it keeps that index.
   */
  const executionIdOrderMap = useMemo(() => {
    const orderMap = new Map<string, number>()
    let colorIndex = 0

    // Process entries in reverse order (oldest first) since entries array is newest-first
    for (let i = filteredEntries.length - 1; i >= 0; i--) {
      const entry = filteredEntries[i]
      if (entry.executionId && !orderMap.has(entry.executionId)) {
        orderMap.set(entry.executionId, colorIndex)
        colorIndex++
      }
    }

    return orderMap
  }, [filteredEntries])

  /**
   * Check if input data exists for selected entry
   */
  const hasInputData = useMemo(() => {
    if (!selectedEntry?.input) return false
    return typeof selectedEntry.input === 'object'
      ? Object.keys(selectedEntry.input).length > 0
      : true
  }, [selectedEntry])

  /**
   * Check if this is a function block with code input
   */
  const shouldShowCodeDisplay = useMemo(() => {
    if (!selectedEntry || !showInput || selectedEntry.blockType !== 'function') return false
    const input = selectedEntry.input
    return typeof input === 'object' && input && 'code' in input && typeof input.code === 'string'
  }, [selectedEntry, showInput])

  /**
   * Get the data to display in the output panel
   */
  const outputData = useMemo(() => {
    if (!selectedEntry) return null
    if (selectedEntry.error) return selectedEntry.error
    return showInput ? selectedEntry.input : selectedEntry.output
  }, [selectedEntry, showInput])

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
      const maxHeight = window.innerHeight * 0.7
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

    const textToCopy = shouldShowCodeDisplay
      ? selectedEntry.input.code
      : JSON.stringify(outputData, null, 2)

    navigator.clipboard.writeText(textToCopy)
    setShowCopySuccess(true)
  }, [selectedEntry, outputData, shouldShowCodeDisplay])

  /**
   * Handle clear console for current workflow
   */
  const handleClearConsole = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (activeWorkflowId) {
        clearWorkflowConsole(activeWorkflowId)
        setSelectedEntry(null)
      }
    },
    [activeWorkflowId, clearWorkflowConsole]
  )

  /**
   * Mark hydration as complete on mount
   */
  useEffect(() => {
    setHasHydrated(true)
  }, [setHasHydrated])

  /**
   * Adjust showInput when selected entry changes
   * Stay on input view if the new entry has input data
   */
  useEffect(() => {
    if (!selectedEntry) {
      setShowInput(false)
      return
    }

    // If we're viewing input but the new entry has no input, switch to output
    if (showInput) {
      const newHasInput =
        selectedEntry.input &&
        (typeof selectedEntry.input === 'object'
          ? Object.keys(selectedEntry.input).length > 0
          : true)

      if (!newHasInput) {
        setShowInput(false)
      }
    }
  }, [selectedEntry, showInput])

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
   * Handle keyboard navigation through logs
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedEntry || filteredEntries.length === 0) return

      // Only handle arrow keys
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return

      // Prevent default scrolling behavior
      e.preventDefault()

      const currentIndex = filteredEntries.findIndex((entry) => entry.id === selectedEntry.id)
      if (currentIndex === -1) return

      if (e.key === 'ArrowUp' && currentIndex > 0) {
        setSelectedEntry(filteredEntries[currentIndex - 1])
      } else if (e.key === 'ArrowDown' && currentIndex < filteredEntries.length - 1) {
        setSelectedEntry(filteredEntries[currentIndex + 1])
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEntry, filteredEntries])

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
      const maxWidth = terminalWidth - BLOCK_COLUMN_WIDTH_PX

      // If current output panel width exceeds max, clamp it
      if (outputPanelWidth > maxWidth && maxWidth >= MIN_OUTPUT_PANEL_WIDTH_PX) {
        setOutputPanelWidth(Math.max(maxWidth, MIN_OUTPUT_PANEL_WIDTH_PX))
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
              <ColumnHeader label='Run ID' width={COLUMN_WIDTHS.RUN_ID} />
              <ColumnHeader label='Duration' width={COLUMN_WIDTHS.DURATION} />
              <ColumnHeader label='Timestamp' width={COLUMN_WIDTHS.TIMESTAMP} />
              {!selectedEntry && (
                <div className='ml-auto flex items-center gap-[8px]'>
                  {filteredEntries.length > 0 && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          onClick={handleClearConsole}
                          aria-label='Clear console'
                          className='!p-1.5 -m-1.5'
                        >
                          <Trash2 className='h-3.5 w-3.5' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        <span>Clear console</span>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  )}
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
                  const runIdColor = getRunIdColor(entry.executionId, executionIdOrderMap)

                  return (
                    <div
                      key={entry.id}
                      className={clsx(
                        'flex h-[36px] cursor-pointer items-center px-[24px] hover:bg-[#2C2C2C]',
                        isSelected && 'bg-[#2C2C2C]'
                      )}
                      onClick={() => handleRowClick(entry)}
                    >
                      {/* Block */}
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

                      {/* Status */}
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
                              className='font-medium text-[11.5px]'
                              style={{ color: statusInfo.isError ? '#EF4444' : '#B7B7B7' }}
                            >
                              {statusInfo.label}
                            </span>
                          </div>
                        ) : (
                          <span className={ROW_TEXT_CLASS}>-</span>
                        )}
                      </div>

                      {/* Run ID */}
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <span
                            className={clsx(
                              COLUMN_WIDTHS.RUN_ID,
                              COLUMN_BASE_CLASS,
                              'truncate font-medium font-mono text-[12px]'
                            )}
                            style={{ color: runIdColor?.text || '#D2D2D2' }}
                          >
                            {formatRunId(entry.executionId)}
                          </span>
                        </Tooltip.Trigger>
                        {entry.executionId && (
                          <Tooltip.Content>
                            <span className='font-mono text-[11px]'>{entry.executionId}</span>
                          </Tooltip.Content>
                        )}
                      </Tooltip.Root>

                      {/* Duration */}
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

                      {/* Timestamp */}
                      <span
                        className={clsx(
                          COLUMN_WIDTHS.TIMESTAMP,
                          COLUMN_BASE_CLASS,
                          'truncate',
                          ROW_TEXT_CLASS
                        )}
                      >
                        {formatTimestamp(entry.timestamp)}
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
                className='group flex h-[30px] flex-shrink-0 cursor-pointer items-center justify-between bg-[#1E1E1E] px-[16px]'
                onClick={handleHeaderClick}
              >
                <div className='flex items-center'>
                  <Button
                    variant='ghost'
                    className={clsx(
                      'px-[8px] py-[6px] text-[12px]',
                      !showInput && hasInputData && '!text-[#E6E6E6] dark:!text-[#E6E6E6]'
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!isExpanded) {
                        setIsToggling(true)
                        const maxHeight = window.innerHeight * 0.7
                        const targetHeight = Math.min(DEFAULT_EXPANDED_HEIGHT, maxHeight)
                        setTerminalHeight(targetHeight)
                      }
                      if (showInput) setShowInput(false)
                    }}
                    aria-label='Show output'
                  >
                    Output
                  </Button>
                  {hasInputData && (
                    <Button
                      variant='ghost'
                      className={clsx(
                        'px-[8px] py-[6px] text-[12px]',
                        showInput && '!text-[#E6E6E6] dark:!text-[#E6E6E6] '
                      )}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!isExpanded) {
                          setIsToggling(true)
                          const maxHeight = window.innerHeight * 0.7
                          const targetHeight = Math.min(DEFAULT_EXPANDED_HEIGHT, maxHeight)
                          setTerminalHeight(targetHeight)
                        }
                        setShowInput(true)
                      }}
                      aria-label='Show input'
                    >
                      Input
                    </Button>
                  )}
                </div>
                <div className='flex items-center gap-[8px]'>
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
                  {filteredEntries.length > 0 && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          onClick={handleClearConsole}
                          aria-label='Clear console'
                          className='!p-1.5 -m-1.5'
                        >
                          <Trash2 className='h-3.5 w-3.5' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        <span>Clear console</span>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  )}
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
                  displayMode === 'prettier' && 'px-[8px] pb-[8px]'
                )}
              >
                {shouldShowCodeDisplay ? (
                  <Code.Viewer
                    code={selectedEntry.input.code}
                    showGutter
                    language={
                      (selectedEntry.input.language as 'javascript' | 'json') || 'javascript'
                    }
                    className='m-0 min-h-full rounded-none border-0 bg-[#1E1E1E]'
                    paddingLeft={8}
                    gutterStyle={{ backgroundColor: 'transparent' }}
                    wrapText={wrapText}
                  />
                ) : displayMode === 'raw' ? (
                  <Code.Viewer
                    code={JSON.stringify(outputData, null, 2)}
                    showGutter
                    language='json'
                    className='m-0 min-h-full rounded-none border-0 bg-[#1E1E1E]'
                    paddingLeft={8}
                    gutterStyle={{ backgroundColor: 'transparent' }}
                    wrapText={wrapText}
                  />
                ) : (
                  <PrettierOutput output={outputData} wrapText={wrapText} />
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
