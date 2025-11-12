'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Clipboard,
  Filter,
  FilterX,
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
  PopoverScrollArea,
  PopoverTrigger,
  Tooltip,
  Wrap,
} from '@/components/emcn'
import { getBlock } from '@/blocks'
import type { ConsoleEntry } from '@/stores/terminal'
import {
  DEFAULT_TERMINAL_HEIGHT,
  useTerminalConsoleStore,
  useTerminalStore,
} from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
// import { PrettierOutput } from './components'
import { useOutputPanelResize, useTerminalFilters, useTerminalResize } from './hooks'

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
const HEADER_TEXT_CLASS =
  'font-medium text-[var(--text-tertiary)] text-[12px] dark:text-[var(--text-tertiary)]'
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
 * Reusable column header component with optional filter button
 */
const ColumnHeader = ({
  label,
  width,
  filterButton,
}: {
  label: string
  width: string
  filterButton?: React.ReactNode
}) => (
  <div className={clsx(width, COLUMN_BASE_CLASS, 'flex items-center')}>
    <span className={HEADER_TEXT_CLASS}>{label}</span>
    {filterButton && <div className='-mt-[0.75px] ml-[8px] flex items-center'>{filterButton}</div>}
  </div>
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
 * Determines if a keyboard event originated from a text-editable element.
 *
 * Treats native inputs, textareas, contenteditable elements, and elements with
 * textbox-like roles as editable. If the event target or any of its ancestors
 * match these criteria, we consider it editable and skip global key handlers.
 *
 * @param e - Keyboard event to inspect
 * @returns True if the event is from an editable context, false otherwise
 */
const isEventFromEditableElement = (e: KeyboardEvent): boolean => {
  const target = e.target as HTMLElement | null
  if (!target) return false

  const isEditable = (el: HTMLElement | null): boolean => {
    if (!el) return false
    if (el instanceof HTMLInputElement) return true
    if (el instanceof HTMLTextAreaElement) return true
    if ((el as HTMLElement).isContentEditable) return true
    const role = el.getAttribute('role')
    if (role === 'textbox' || role === 'combobox') return true
    return false
  }

  // Check target and walk up ancestors in case editors render nested elements
  let el: HTMLElement | null = target
  while (el) {
    if (isEditable(el)) return true
    el = el.parentElement
  }
  return false
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
  const prevEntriesLengthRef = useRef(0)
  const {
    terminalHeight,
    setTerminalHeight,
    outputPanelWidth,
    setOutputPanelWidth,
    // displayMode,
    // setDisplayMode,
    setHasHydrated,
  } = useTerminalStore()
  const entries = useTerminalConsoleStore((state) => state.entries)
  const clearWorkflowConsole = useTerminalConsoleStore((state) => state.clearWorkflowConsole)
  const { activeWorkflowId } = useWorkflowRegistry()
  const [selectedEntry, setSelectedEntry] = useState<ConsoleEntry | null>(null)
  const [isToggling, setIsToggling] = useState(false)
  // const [displayPopoverOpen, setDisplayPopoverOpen] = useState(false)
  const [wrapText, setWrapText] = useState(true)
  const [showCopySuccess, setShowCopySuccess] = useState(false)
  const [showInput, setShowInput] = useState(false)
  const [autoSelectEnabled, setAutoSelectEnabled] = useState(true)
  const [blockFilterOpen, setBlockFilterOpen] = useState(false)
  const [statusFilterOpen, setStatusFilterOpen] = useState(false)
  const [runIdFilterOpen, setRunIdFilterOpen] = useState(false)

  // Terminal resize hooks
  const { handleMouseDown } = useTerminalResize()
  const { handleMouseDown: handleOutputPanelResizeMouseDown } = useOutputPanelResize()

  // Terminal filters hook
  const {
    filters,
    sortConfig,
    toggleBlock,
    toggleStatus,
    toggleRunId,
    toggleSort,
    clearFilters,
    filterEntries,
    hasActiveFilters,
  } = useTerminalFilters()

  const isExpanded = terminalHeight > NEAR_MIN_THRESHOLD

  /**
   * Get all entries for current workflow (before filtering) for filter options
   */
  const allWorkflowEntries = useMemo(() => {
    if (!activeWorkflowId) return []
    return entries.filter((entry) => entry.workflowId === activeWorkflowId)
  }, [entries, activeWorkflowId])

  /**
   * Filter entries for current workflow and apply filters
   */
  const filteredEntries = useMemo(() => {
    return filterEntries(allWorkflowEntries)
  }, [allWorkflowEntries, filterEntries])

  /**
   * Get unique blocks (by ID) from all workflow entries
   */
  const uniqueBlocks = useMemo(() => {
    const blocksMap = new Map<string, { blockId: string; blockName: string; blockType: string }>()
    allWorkflowEntries.forEach((entry) => {
      if (!blocksMap.has(entry.blockId)) {
        blocksMap.set(entry.blockId, {
          blockId: entry.blockId,
          blockName: entry.blockName,
          blockType: entry.blockType,
        })
      }
    })
    return Array.from(blocksMap.values()).sort((a, b) => a.blockName.localeCompare(b.blockName))
  }, [allWorkflowEntries])

  /**
   * Get unique run IDs from all workflow entries
   */
  const uniqueRunIds = useMemo(() => {
    const runIdsSet = new Set<string>()
    allWorkflowEntries.forEach((entry) => {
      if (entry.executionId) {
        runIdsSet.add(entry.executionId)
      }
    })
    return Array.from(runIdsSet).sort()
  }, [allWorkflowEntries])

  /**
   * Check if there are any entries with status information (error or success)
   */
  const hasStatusEntries = useMemo(() => {
    return allWorkflowEntries.some((entry) => entry.error || entry.success !== undefined)
  }, [allWorkflowEntries])

  /**
   * Create stable execution ID to color index mapping based on order of first appearance.
   * Once an execution ID is assigned a color index, it keeps that index.
   * Uses all workflow entries to maintain consistent colors regardless of active filters.
   */
  const executionIdOrderMap = useMemo(() => {
    const orderMap = new Map<string, number>()
    let colorIndex = 0

    // Process entries in reverse order (oldest first) since entries array is newest-first
    // Use allWorkflowEntries to ensure colors remain consistent when filters change
    for (let i = allWorkflowEntries.length - 1; i >= 0; i--) {
      const entry = allWorkflowEntries[i]
      if (entry.executionId && !orderMap.has(entry.executionId)) {
        orderMap.set(entry.executionId, colorIndex)
        colorIndex++
      }
    }

    return orderMap
  }, [allWorkflowEntries])

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
    if (showInput) return selectedEntry.input
    if (selectedEntry.error) return selectedEntry.error
    return selectedEntry.output
  }, [selectedEntry, showInput])

  /**
   * Handle row click - toggle if clicking same entry
   * Disables auto-selection when user manually selects, re-enables when deselecting
   */
  const handleRowClick = useCallback((entry: ConsoleEntry) => {
    setSelectedEntry((prev) => {
      const isDeselecting = prev?.id === entry.id
      // Re-enable auto-select when deselecting, disable when selecting
      setAutoSelectEnabled(isDeselecting)
      return isDeselecting ? null : entry
    })
  }, [])

  /**
   * Handle header click - toggle between expanded and collapsed
   */
  const handleHeaderClick = useCallback(() => {
    setIsToggling(true)

    if (isExpanded) {
      setTerminalHeight(MIN_HEIGHT)
    } else {
      setTerminalHeight(DEFAULT_TERMINAL_HEIGHT)
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
   * Auto-select the latest entry when new logs arrive
   * Re-enables auto-selection when all entries are cleared
   * Only auto-selects when NEW entries are added (length increases)
   */
  useEffect(() => {
    if (filteredEntries.length === 0) {
      // Re-enable auto-selection when console is cleared
      setAutoSelectEnabled(true)
      setSelectedEntry(null)
      prevEntriesLengthRef.current = 0
      return
    }

    // Auto-select the latest entry only when a NEW entry is added (length increased)
    if (autoSelectEnabled && filteredEntries.length > prevEntriesLengthRef.current) {
      const latestEntry = filteredEntries[0]
      setSelectedEntry(latestEntry)
    }

    prevEntriesLengthRef.current = filteredEntries.length
  }, [filteredEntries, autoSelectEnabled])

  /**
   * Handle keyboard navigation through logs
   * Disables auto-selection when user manually navigates
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing/navigating inside editable inputs/editors
      if (isEventFromEditableElement(e)) return

      if (!selectedEntry || filteredEntries.length === 0) return

      // Only handle arrow keys
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return

      // Prevent default scrolling behavior
      e.preventDefault()

      const currentIndex = filteredEntries.findIndex((entry) => entry.id === selectedEntry.id)
      if (currentIndex === -1) return

      if (e.key === 'ArrowUp' && currentIndex > 0) {
        setAutoSelectEnabled(false)
        setSelectedEntry(filteredEntries[currentIndex - 1])
      } else if (e.key === 'ArrowDown' && currentIndex < filteredEntries.length - 1) {
        setAutoSelectEnabled(false)
        setSelectedEntry(filteredEntries[currentIndex + 1])
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEntry, filteredEntries])

  /**
   * Handle keyboard navigation for input/output toggle
   * Left arrow shows output, right arrow shows input
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing/navigating inside editable inputs/editors
      if (isEventFromEditableElement(e)) return

      if (!selectedEntry) return

      // Only handle left/right arrow keys
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return

      // Prevent default scrolling behavior
      e.preventDefault()

      // Expand terminal if collapsed
      if (!isExpanded) {
        setIsToggling(true)
        const maxHeight = window.innerHeight * 0.7
        const targetHeight = Math.min(DEFAULT_EXPANDED_HEIGHT, maxHeight)
        setTerminalHeight(targetHeight)
      }

      if (e.key === 'ArrowLeft') {
        // Show output
        if (showInput) {
          setShowInput(false)
        }
      } else if (e.key === 'ArrowRight') {
        // Show input (only if input data exists)
        if (!showInput && hasInputData) {
          setShowInput(true)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEntry, showInput, hasInputData, isExpanded])

  /**
   * Handle Escape to unselect and Enter to re-enable auto-selection
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedEntry) {
        // Escape unselects the current entry and re-enables auto-selection
        e.preventDefault()
        setSelectedEntry(null)
        setAutoSelectEnabled(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEntry])

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
          'terminal-container fixed right-[var(--panel-width)] bottom-0 left-[var(--sidebar-width)] z-10 overflow-hidden dark:bg-[var(--surface-1)]',
          isToggling && 'transition-[height] duration-100 ease-out'
        )}
        onTransitionEnd={handleTransitionEnd}
        aria-label='Terminal'
      >
        <div className='relative flex h-full border-t dark:border-[var(--border)]'>
          {/* Left Section - Logs Table */}
          <div
            className={clsx('flex flex-col', !selectedEntry && 'flex-1')}
            style={selectedEntry ? { width: `calc(100% - ${outputPanelWidth}px)` } : undefined}
          >
            {/* Header */}
            <div
              className='group flex h-[30px] flex-shrink-0 cursor-pointer items-center bg-[var(--surface-1)] pr-[16px] pl-[24px]'
              onClick={handleHeaderClick}
            >
              {uniqueBlocks.length > 0 ? (
                <div className={clsx(COLUMN_WIDTHS.BLOCK, COLUMN_BASE_CLASS, 'flex items-center')}>
                  <Popover open={blockFilterOpen} onOpenChange={setBlockFilterOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant='ghost'
                        className='!h-auto !p-0 flex items-center'
                        onClick={(e) => e.stopPropagation()}
                        aria-label='Filter by block'
                      >
                        <span className={HEADER_TEXT_CLASS}>Block</span>
                        <div className='-mt-[0.75px] ml-[8px] flex items-center'>
                          <Filter
                            className={clsx(
                              'h-[11px] w-[11px]',
                              filters.blockIds.size > 0 && 'text-[var(--brand-secondary)]'
                            )}
                          />
                        </div>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      side='bottom'
                      align='start'
                      sideOffset={4}
                      onClick={(e) => e.stopPropagation()}
                      style={{ minWidth: '120px', maxWidth: '120px' }}
                    >
                      <PopoverScrollArea style={{ maxHeight: '140px' }}>
                        {uniqueBlocks.map((block, index) => {
                          const BlockIcon = getBlockIcon(block.blockType)
                          const isSelected = filters.blockIds.has(block.blockId)

                          return (
                            <PopoverItem
                              key={block.blockId}
                              active={isSelected}
                              onClick={() => toggleBlock(block.blockId)}
                              className={index > 0 ? 'mt-[2px]' : ''}
                            >
                              {BlockIcon && <BlockIcon className='h-3 w-3' />}
                              <span className='flex-1'>{block.blockName}</span>
                              {isSelected && <Check className='h-3 w-3' />}
                            </PopoverItem>
                          )
                        })}
                      </PopoverScrollArea>
                    </PopoverContent>
                  </Popover>
                </div>
              ) : (
                <ColumnHeader label='Block' width={COLUMN_WIDTHS.BLOCK} />
              )}
              {hasStatusEntries ? (
                <div className={clsx(COLUMN_WIDTHS.STATUS, COLUMN_BASE_CLASS, 'flex items-center')}>
                  <Popover open={statusFilterOpen} onOpenChange={setStatusFilterOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant='ghost'
                        className='!h-auto !p-0 flex items-center'
                        onClick={(e) => e.stopPropagation()}
                        aria-label='Filter by status'
                      >
                        <span className={HEADER_TEXT_CLASS}>Status</span>
                        <div className='-mt-[0.75px] ml-[8px] flex items-center'>
                          <Filter
                            className={clsx(
                              'h-[11px] w-[11px]',
                              filters.statuses.size > 0 && 'text-[var(--brand-secondary)]'
                            )}
                          />
                        </div>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      side='bottom'
                      align='start'
                      sideOffset={4}
                      onClick={(e) => e.stopPropagation()}
                      style={{ minWidth: '120px', maxWidth: '120px' }}
                    >
                      <PopoverScrollArea style={{ maxHeight: '140px' }}>
                        <PopoverItem
                          active={filters.statuses.has('error')}
                          onClick={() => toggleStatus('error')}
                        >
                          <div
                            className='h-[6px] w-[6px] rounded-[2px]'
                            style={{ backgroundColor: '#EF4444' }}
                          />
                          <span className='flex-1'>Error</span>
                          {filters.statuses.has('error') && <Check className='h-3 w-3' />}
                        </PopoverItem>
                        <PopoverItem
                          active={filters.statuses.has('info')}
                          onClick={() => toggleStatus('info')}
                          className='mt-[2px]'
                        >
                          <div
                            className='h-[6px] w-[6px] rounded-[2px]'
                            style={{ backgroundColor: '#B7B7B7' }}
                          />
                          <span className='flex-1'>Info</span>
                          {filters.statuses.has('info') && <Check className='h-3 w-3' />}
                        </PopoverItem>
                      </PopoverScrollArea>
                    </PopoverContent>
                  </Popover>
                </div>
              ) : (
                <ColumnHeader label='Status' width={COLUMN_WIDTHS.STATUS} />
              )}
              {uniqueRunIds.length > 0 ? (
                <div className={clsx(COLUMN_WIDTHS.RUN_ID, COLUMN_BASE_CLASS, 'flex items-center')}>
                  <Popover open={runIdFilterOpen} onOpenChange={setRunIdFilterOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant='ghost'
                        className='!h-auto !p-0 flex items-center'
                        onClick={(e) => e.stopPropagation()}
                        aria-label='Filter by run ID'
                      >
                        <span className={HEADER_TEXT_CLASS}>Run ID</span>
                        <div className='-mt-[0.75px] ml-[8px] flex items-center'>
                          <Filter
                            className={clsx(
                              'h-[11px] w-[11px]',
                              filters.runIds.size > 0 && 'text-[var(--brand-secondary)]'
                            )}
                          />
                        </div>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      side='bottom'
                      align='start'
                      sideOffset={4}
                      onClick={(e) => e.stopPropagation()}
                      style={{ minWidth: '90px', maxWidth: '90px' }}
                    >
                      <PopoverScrollArea style={{ maxHeight: '140px' }}>
                        {uniqueRunIds.map((runId, index) => {
                          const isSelected = filters.runIds.has(runId)
                          const runIdColor = getRunIdColor(runId, executionIdOrderMap)

                          return (
                            <PopoverItem
                              key={runId}
                              active={isSelected}
                              onClick={() => toggleRunId(runId)}
                              className={index > 0 ? 'mt-[2px]' : ''}
                            >
                              <span
                                className='flex-1 font-mono text-[12px]'
                                style={{ color: runIdColor?.text || '#D2D2D2' }}
                              >
                                {formatRunId(runId)}
                              </span>
                              {isSelected && <Check className='h-3 w-3' />}
                            </PopoverItem>
                          )
                        })}
                      </PopoverScrollArea>
                    </PopoverContent>
                  </Popover>
                </div>
              ) : (
                <ColumnHeader label='Run ID' width={COLUMN_WIDTHS.RUN_ID} />
              )}
              <ColumnHeader label='Duration' width={COLUMN_WIDTHS.DURATION} />
              {allWorkflowEntries.length > 0 ? (
                <div
                  className={clsx(COLUMN_WIDTHS.TIMESTAMP, COLUMN_BASE_CLASS, 'flex items-center')}
                >
                  <Button
                    variant='ghost'
                    className='!h-auto !p-0 flex items-center'
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleSort()
                    }}
                    aria-label='Sort by timestamp'
                  >
                    <span className={HEADER_TEXT_CLASS}>Timestamp</span>
                    <div className='-mt-[0.75px] ml-[8px] flex items-center'>
                      {sortConfig.direction === 'desc' ? (
                        <ArrowDown className='h-[13px] w-[13px]' />
                      ) : (
                        <ArrowUp className='h-[13px] w-[13px]' />
                      )}
                    </div>
                  </Button>
                </div>
              ) : (
                <ColumnHeader label='Timestamp' width={COLUMN_WIDTHS.TIMESTAMP} />
              )}
              {!selectedEntry && (
                <div className='ml-auto flex items-center gap-[8px]'>
                  {hasActiveFilters && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          onClick={(e) => {
                            e.stopPropagation()
                            clearFilters()
                          }}
                          aria-label='Clear filters'
                          className='!p-1.5 -m-1.5'
                        >
                          <FilterX className='h-3 w-3' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        <span>Clear filters</span>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  )}
                  {filteredEntries.length > 0 && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          onClick={handleClearConsole}
                          aria-label='Clear console'
                          className='!p-1.5 -m-1.5'
                        >
                          <Trash2 className='h-3 w-3' />
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
                <div className='flex h-full items-center justify-center text-[#8D8D8D] text-[13px]'>
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
                        'flex h-[36px] cursor-pointer items-center px-[24px] hover:bg-[var(--border)]',
                        isSelected && 'bg-[var(--border)]'
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
              className='absolute top-0 right-0 bottom-0 flex flex-col border-l dark:border-[var(--border)] dark:bg-[var(--surface-1)]'
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
                className='group flex h-[30px] flex-shrink-0 cursor-pointer items-center justify-between bg-[var(--surface-1)] px-[16px]'
                onClick={handleHeaderClick}
              >
                <div className='flex items-center'>
                  <Button
                    variant='ghost'
                    className={clsx(
                      'px-[8px] py-[6px] text-[12px]',
                      !showInput &&
                        hasInputData &&
                        '!text-[var(--text-primary)] dark:!text-[var(--text-primary)]'
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
                        showInput && '!text-[var(--text-primary)] dark:!text-[var(--text-primary)] '
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
                          <Clipboard className='h-[12px] w-[12px]' />
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
                  {/* <Popover open={displayPopoverOpen} onOpenChange={setDisplayPopoverOpen}>
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
                    <PopoverContent
                      side='bottom'
                      align='end'
                      sideOffset={4}
                      collisionPadding={0}
                      onClick={(e) => e.stopPropagation()}
                    >
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
                  </Popover> */}
                  {hasActiveFilters && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          onClick={(e) => {
                            e.stopPropagation()
                            clearFilters()
                          }}
                          aria-label='Clear filters'
                          className='!p-1.5 -m-1.5'
                        >
                          <FilterX className='h-3 w-3' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        <span>Clear filters</span>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  )}
                  {filteredEntries.length > 0 && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          onClick={handleClearConsole}
                          aria-label='Clear console'
                          className='!p-1.5 -m-1.5'
                        >
                          <Trash2 className='h-3 w-3' />
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
                className='flex-1 overflow-x-auto overflow-y-auto'
                // className={clsx(
                //   'flex-1 overflow-x-auto overflow-y-auto',
                //   displayMode === 'prettier' && 'px-[8px] pb-[8px]'
                // )}
              >
                {shouldShowCodeDisplay ? (
                  <Code.Viewer
                    code={selectedEntry.input.code}
                    showGutter
                    language={
                      (selectedEntry.input.language as 'javascript' | 'json') || 'javascript'
                    }
                    className='m-0 min-h-full rounded-none border-0 bg-[var(--surface-1)]'
                    paddingLeft={8}
                    gutterStyle={{ backgroundColor: 'transparent' }}
                    wrapText={wrapText}
                  />
                ) : (
                  <Code.Viewer
                    code={JSON.stringify(outputData, null, 2)}
                    showGutter
                    language='json'
                    className='m-0 min-h-full rounded-none border-0 bg-[var(--surface-1)]'
                    paddingLeft={8}
                    gutterStyle={{ backgroundColor: 'transparent' }}
                    wrapText={wrapText}
                  />
                )}
                {/* ) : displayMode === 'raw' ? (
                  <Code.Viewer
                    code={JSON.stringify(outputData, null, 2)}
                    showGutter
                    language='json'
                    className='m-0 min-h-full rounded-none border-0 bg-[var(--surface-1)]'
                    paddingLeft={8}
                    gutterStyle={{ backgroundColor: 'transparent' }}
                    wrapText={wrapText}
                  />
                ) : (
                  <PrettierOutput output={outputData} wrapText={wrapText} />
                )} */}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
