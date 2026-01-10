'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Check,
  ChevronDown,
  Clipboard,
  Database,
  Filter,
  FilterX,
  MoreHorizontal,
  Palette,
  Pause,
  RepeatIcon,
  Search,
  SplitIcon,
  Trash2,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useShallow } from 'zustand/react/shallow'
import {
  Badge,
  Button,
  Code,
  Input,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverTrigger,
  Tooltip,
} from '@/components/emcn'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import {
  LogRowContextMenu,
  OutputContextMenu,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components'
import {
  useOutputPanelResize,
  useTerminalFilters,
  useTerminalResize,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/hooks'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { getBlock } from '@/blocks'
import { useCodeViewerFeatures } from '@/hooks/use-code-viewer'
import { OUTPUT_PANEL_WIDTH, TERMINAL_HEIGHT } from '@/stores/constants'
import { useCopilotTrainingStore } from '@/stores/copilot-training/store'
import { useGeneralStore } from '@/stores/settings/general'
import type { ConsoleEntry } from '@/stores/terminal'
import { useTerminalConsoleStore, useTerminalStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * Terminal height configuration constants
 */
const MIN_HEIGHT = TERMINAL_HEIGHT.MIN
const NEAR_MIN_THRESHOLD = 40
const DEFAULT_EXPANDED_HEIGHT = TERMINAL_HEIGHT.DEFAULT

/**
 * Column width constants - numeric values for calculations
 */
const BLOCK_COLUMN_WIDTH_PX = 240
const MIN_OUTPUT_PANEL_WIDTH_PX = OUTPUT_PANEL_WIDTH.MIN

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
const HEADER_TEXT_CLASS = 'font-medium text-[var(--text-tertiary)] text-[12px]'
const ROW_TEXT_CLASS = 'font-medium text-[var(--text-primary)] text-[12px]'
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
  <Button variant='ghost' className='!p-1.5 -m-1.5' onClick={onClick} aria-label='Toggle terminal'>
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

interface OutputCodeContentProps {
  code: string
  language: 'javascript' | 'json'
  wrapText: boolean
  searchQuery: string | undefined
  currentMatchIndex: number
  onMatchCountChange: (count: number) => void
  contentRef: React.RefObject<HTMLDivElement | null>
}

const OutputCodeContent = React.memo(function OutputCodeContent({
  code,
  language,
  wrapText,
  searchQuery,
  currentMatchIndex,
  onMatchCountChange,
  contentRef,
}: OutputCodeContentProps) {
  return (
    <Code.Viewer
      code={code}
      showGutter
      language={language}
      className='m-0 min-h-full rounded-none border-0 bg-[var(--surface-1)]'
      paddingLeft={8}
      gutterStyle={{ backgroundColor: 'transparent' }}
      wrapText={wrapText}
      searchQuery={searchQuery}
      currentMatchIndex={currentMatchIndex}
      onMatchCountChange={onMatchCountChange}
      contentRef={contentRef}
      virtualized
    />
  )
})

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
  const prevWorkflowEntriesLengthRef = useRef(0)
  const {
    setTerminalHeight,
    lastExpandedHeight,
    outputPanelWidth,
    setOutputPanelWidth,
    openOnRun,
    setOpenOnRun,
    wrapText,
    setWrapText,
    setHasHydrated,
  } = useTerminalStore()
  const isExpanded = useTerminalStore((state) => state.terminalHeight > NEAR_MIN_THRESHOLD)
  const { activeWorkflowId } = useWorkflowRegistry()
  const workflowEntriesSelector = useCallback(
    (state: { entries: ConsoleEntry[] }) =>
      state.entries.filter((entry) => entry.workflowId === activeWorkflowId),
    [activeWorkflowId]
  )
  const entries = useTerminalConsoleStore(useShallow(workflowEntriesSelector))
  const clearWorkflowConsole = useTerminalConsoleStore((state) => state.clearWorkflowConsole)
  const exportConsoleCSV = useTerminalConsoleStore((state) => state.exportConsoleCSV)
  const [selectedEntry, setSelectedEntry] = useState<ConsoleEntry | null>(null)
  const [isToggling, setIsToggling] = useState(false)
  const [showCopySuccess, setShowCopySuccess] = useState(false)
  const [showInput, setShowInput] = useState(false)
  const [autoSelectEnabled, setAutoSelectEnabled] = useState(true)
  const [blockFilterOpen, setBlockFilterOpen] = useState(false)
  const [statusFilterOpen, setStatusFilterOpen] = useState(false)
  const [runIdFilterOpen, setRunIdFilterOpen] = useState(false)
  const [mainOptionsOpen, setMainOptionsOpen] = useState(false)
  const [outputOptionsOpen, setOutputOptionsOpen] = useState(false)

  const outputContentRef = useRef<HTMLDivElement>(null)
  const {
    isSearchActive: isOutputSearchActive,
    searchQuery: outputSearchQuery,
    setSearchQuery: setOutputSearchQuery,
    matchCount,
    currentMatchIndex,
    activateSearch: activateOutputSearch,
    closeSearch: closeOutputSearch,
    goToNextMatch,
    goToPreviousMatch,
    handleMatchCountChange,
    searchInputRef: outputSearchInputRef,
  } = useCodeViewerFeatures({
    contentRef: outputContentRef,
    externalWrapText: wrapText,
    onWrapTextChange: setWrapText,
  })

  const [isTrainingEnvEnabled, setIsTrainingEnvEnabled] = useState(false)
  const showTrainingControls = useGeneralStore((state) => state.showTrainingControls)
  const { isTraining, toggleModal: toggleTrainingModal, stopTraining } = useCopilotTrainingStore()

  const [isPlaygroundEnabled, setIsPlaygroundEnabled] = useState(false)

  const { handleMouseDown } = useTerminalResize()
  const { handleMouseDown: handleOutputPanelResizeMouseDown } = useOutputPanelResize()

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

  const [hasSelection, setHasSelection] = useState(false)
  const [contextMenuEntry, setContextMenuEntry] = useState<ConsoleEntry | null>(null)
  const [storedSelectionText, setStoredSelectionText] = useState('')

  const {
    isOpen: isLogRowMenuOpen,
    position: logRowMenuPosition,
    menuRef: logRowMenuRef,
    handleContextMenu: handleLogRowContextMenu,
    closeMenu: closeLogRowMenu,
  } = useContextMenu()

  const {
    isOpen: isOutputMenuOpen,
    position: outputMenuPosition,
    menuRef: outputMenuRef,
    handleContextMenu: handleOutputContextMenu,
    closeMenu: closeOutputMenu,
  } = useContextMenu()

  /**
   * Expands the terminal to its last meaningful height, with safeguards:
   * - Never expands below {@link DEFAULT_EXPANDED_HEIGHT}.
   * - Never exceeds 70% of the viewport height.
   */
  const expandToLastHeight = useCallback(() => {
    setIsToggling(true)
    const maxHeight = window.innerHeight * 0.7
    const desiredHeight = Math.max(
      lastExpandedHeight || DEFAULT_EXPANDED_HEIGHT,
      DEFAULT_EXPANDED_HEIGHT
    )
    const targetHeight = Math.min(desiredHeight, maxHeight)
    setTerminalHeight(targetHeight)
  }, [lastExpandedHeight, setTerminalHeight])

  const allWorkflowEntries = entries

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

  const outputDataStringified = useMemo(() => {
    if (outputData === null || outputData === undefined) return ''
    return JSON.stringify(outputData, null, 2)
  }, [outputData])

  /**
   * Auto-open the terminal on new entries when "Open on run" is enabled.
   * This mirrors the header toggle behavior by using expandToLastHeight,
   * ensuring we always get the same smooth height transition.
   */
  useEffect(() => {
    if (!openOnRun) {
      prevWorkflowEntriesLengthRef.current = allWorkflowEntries.length
      return
    }

    const previousLength = prevWorkflowEntriesLengthRef.current
    const currentLength = allWorkflowEntries.length

    if (currentLength > previousLength && !isExpanded) {
      expandToLastHeight()
    }

    prevWorkflowEntriesLengthRef.current = currentLength
  }, [allWorkflowEntries.length, expandToLastHeight, openOnRun, isExpanded])

  /**
   * Handle row click - toggle if clicking same entry
   * Disables auto-selection when user manually selects, re-enables when deselecting
   */
  const handleRowClick = useCallback((entry: ConsoleEntry) => {
    setSelectedEntry((prev) => {
      const isDeselecting = prev?.id === entry.id
      setAutoSelectEnabled(isDeselecting)
      return isDeselecting ? null : entry
    })
  }, [])

  const handleHeaderClick = useCallback(() => {
    if (isExpanded) {
      setIsToggling(true)
      setTerminalHeight(MIN_HEIGHT)
    } else {
      expandToLastHeight()
    }
  }, [expandToLastHeight, isExpanded, setTerminalHeight])

  const handleTransitionEnd = useCallback(() => {
    setIsToggling(false)
  }, [])

  const handleCopy = useCallback(() => {
    if (!selectedEntry) return

    const textToCopy = shouldShowCodeDisplay ? selectedEntry.input.code : outputDataStringified

    navigator.clipboard.writeText(textToCopy)
    setShowCopySuccess(true)
  }, [selectedEntry, outputDataStringified, shouldShowCodeDisplay])

  /**
   * Clears the console for the active workflow.
   *
   * Extracted so it can be reused both by click handlers and global commands.
   */
  const clearCurrentWorkflowConsole = useCallback(() => {
    if (activeWorkflowId) {
      clearWorkflowConsole(activeWorkflowId)
      setSelectedEntry(null)
    }
  }, [activeWorkflowId, clearWorkflowConsole])

  const handleClearConsole = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      clearCurrentWorkflowConsole()
    },
    [clearCurrentWorkflowConsole]
  )

  const handleExportConsole = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (activeWorkflowId) {
        exportConsoleCSV(activeWorkflowId)
      }
    },
    [activeWorkflowId, exportConsoleCSV]
  )

  const handleCopySelection = useCallback(() => {
    if (storedSelectionText) {
      navigator.clipboard.writeText(storedSelectionText)
      setShowCopySuccess(true)
    }
  }, [storedSelectionText])

  const handleOutputPanelContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const selection = window.getSelection()
      const selectionText = selection?.toString() || ''
      setStoredSelectionText(selectionText)
      setHasSelection(selectionText.length > 0)
      handleOutputContextMenu(e)
    },
    [handleOutputContextMenu]
  )

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, entry: ConsoleEntry) => {
      setContextMenuEntry(entry)
      handleLogRowContextMenu(e)
    },
    [handleLogRowContextMenu]
  )

  const handleFilterByBlock = useCallback(
    (blockId: string) => {
      toggleBlock(blockId)
      closeLogRowMenu()
    },
    [toggleBlock, closeLogRowMenu]
  )

  const handleFilterByStatus = useCallback(
    (status: 'error' | 'info') => {
      toggleStatus(status)
      closeLogRowMenu()
    },
    [toggleStatus, closeLogRowMenu]
  )

  const handleFilterByRunId = useCallback(
    (runId: string) => {
      toggleRunId(runId)
      closeLogRowMenu()
    },
    [toggleRunId, closeLogRowMenu]
  )

  const handleCopyRunId = useCallback(
    (runId: string) => {
      navigator.clipboard.writeText(runId)
      closeLogRowMenu()
    },
    [closeLogRowMenu]
  )

  const handleClearConsoleFromMenu = useCallback(() => {
    clearCurrentWorkflowConsole()
  }, [clearCurrentWorkflowConsole])

  const handleTrainingClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isTraining) {
        stopTraining()
      } else {
        toggleTrainingModal()
      }
    },
    [isTraining, stopTraining, toggleTrainingModal]
  )

  const shouldShowTrainingButton = isTrainingEnvEnabled && showTrainingControls

  /**
   * Register global keyboard shortcuts for the terminal:
   * - Mod+D: Clear terminal console for the active workflow
   *
   * The command is disabled in editable contexts so it does not interfere
   * with typing inside inputs, textareas, or editors.
   */
  useRegisterGlobalCommands(() =>
    createCommands([
      {
        id: 'clear-terminal-console',
        handler: () => {
          clearCurrentWorkflowConsole()
        },
        overrides: {
          allowInEditable: false,
        },
      },
    ])
  )

  /**
   * Mark hydration as complete on mount
   */
  useEffect(() => {
    setHasHydrated(true)
  }, [setHasHydrated])

  /**
   * Check environment variables on mount
   */
  useEffect(() => {
    setIsTrainingEnvEnabled(isTruthy(getEnv('NEXT_PUBLIC_COPILOT_TRAINING_ENABLED')))
    setIsPlaygroundEnabled(isTruthy(getEnv('NEXT_PUBLIC_ENABLE_PLAYGROUND')))
  }, [])

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
   * Track text selection state for context menu.
   * Skip updates when the context menu is open to prevent the selection
   * state from changing mid-click (which would disable the copy button).
   */
  useEffect(() => {
    const handleSelectionChange = () => {
      if (isOutputMenuOpen) return

      const selection = window.getSelection()
      setHasSelection(Boolean(selection && selection.toString().length > 0))
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [isOutputMenuOpen])

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
      if (isEventFromEditableElement(e)) return
      const activeElement = document.activeElement as HTMLElement | null
      const toolbarRoot = document.querySelector(
        '[data-toolbar-root][data-search-active=\"true\"]'
      ) as HTMLElement | null
      if (toolbarRoot && activeElement && toolbarRoot.contains(activeElement)) {
        return
      }

      if (!selectedEntry || filteredEntries.length === 0) return

      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return

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

      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return

      e.preventDefault()

      if (!isExpanded) {
        expandToLastHeight()
      }

      if (e.key === 'ArrowLeft') {
        if (showInput) {
          setShowInput(false)
        }
      } else if (e.key === 'ArrowRight') {
        if (!showInput && hasInputData) {
          setShowInput(true)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [expandToLastHeight, selectedEntry, showInput, hasInputData, isExpanded])

  /**
   * Handle Escape to unselect entry (search close is handled by useCodeViewerFeatures)
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isOutputSearchActive && selectedEntry) {
        e.preventDefault()
        setSelectedEntry(null)
        setAutoSelectEnabled(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEntry, isOutputSearchActive])

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

      const terminalWidth = window.innerWidth - sidebarWidth - panelWidth
      const maxWidth = terminalWidth - BLOCK_COLUMN_WIDTH_PX

      if (outputPanelWidth > maxWidth && maxWidth >= MIN_OUTPUT_PANEL_WIDTH_PX) {
        setOutputPanelWidth(Math.max(maxWidth, MIN_OUTPUT_PANEL_WIDTH_PX))
      }
    }

    handleResize()

    window.addEventListener('resize', handleResize)

    const observer = new MutationObserver(() => {
      handleResize()
    })

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
          'terminal-container fixed right-[var(--panel-width)] bottom-0 left-[var(--sidebar-width)] z-10 overflow-hidden bg-[var(--surface-1)]',
          isToggling && 'transition-[height] duration-100 ease-out'
        )}
        onTransitionEnd={handleTransitionEnd}
        aria-label='Terminal'
      >
        <div className='relative flex h-full border-[var(--border)] border-t'>
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
                      minWidth={120}
                      maxWidth={200}
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
                            style={{ backgroundColor: 'var(--text-error)' }}
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
                            style={{ backgroundColor: 'var(--terminal-status-info-color)' }}
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
                  {isPlaygroundEnabled && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Link href='/playground'>
                          <Button
                            variant='ghost'
                            aria-label='Component Playground'
                            className='!p-1.5 -m-1.5'
                          >
                            <Palette className='h-3 w-3' />
                          </Button>
                        </Link>
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        <span>Component Playground</span>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  )}
                  {shouldShowTrainingButton && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          onClick={handleTrainingClick}
                          aria-label={isTraining ? 'Stop training' : 'Train Copilot'}
                          className={clsx(
                            '!p-1.5 -m-1.5',
                            isTraining && 'text-orange-600 dark:text-orange-400'
                          )}
                        >
                          {isTraining ? (
                            <Pause className='h-3 w-3' />
                          ) : (
                            <Database className='h-3 w-3' />
                          )}
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        <span>{isTraining ? 'Stop Training' : 'Train Copilot'}</span>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  )}
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
                    <>
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <Button
                            variant='ghost'
                            onClick={handleExportConsole}
                            aria-label='Download console CSV'
                            className='!p-1.5 -m-1.5'
                          >
                            <ArrowDownToLine className='h-3 w-3' />
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content>
                          <span>Download CSV</span>
                        </Tooltip.Content>
                      </Tooltip.Root>
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
                          <Tooltip.Shortcut keys='⌘D'>Clear console</Tooltip.Shortcut>
                        </Tooltip.Content>
                      </Tooltip.Root>
                    </>
                  )}
                  <Popover open={mainOptionsOpen} onOpenChange={setMainOptionsOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant='ghost'
                        onClick={(e) => {
                          e.stopPropagation()
                        }}
                        aria-label='Terminal options'
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
                      style={{ minWidth: '140px', maxWidth: '160px' }}
                      className='gap-[2px]'
                    >
                      <PopoverItem
                        active={openOnRun}
                        showCheck
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpenOnRun(!openOnRun)
                        }}
                      >
                        <span>Open on run</span>
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
                        'flex h-[36px] cursor-pointer items-center px-[24px] hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-4)]',
                        isSelected && 'bg-[var(--surface-6)] dark:bg-[var(--surface-4)]'
                      )}
                      onClick={() => handleRowClick(entry)}
                      onContextMenu={(e) => handleRowContextMenu(e, entry)}
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
                          <BlockIcon className='h-[13px] w-[13px] flex-shrink-0 text-[var(--text-secondary)]' />
                        )}
                        <span className={clsx('truncate', ROW_TEXT_CLASS)}>{entry.blockName}</span>
                      </div>

                      {/* Status */}
                      <div
                        className={clsx(
                          COLUMN_WIDTHS.STATUS,
                          COLUMN_BASE_CLASS,
                          'flex items-center'
                        )}
                      >
                        {statusInfo ? (
                          <Badge variant={statusInfo.isError ? 'red' : 'gray'} dot>
                            {statusInfo.label}
                          </Badge>
                        ) : (
                          <span className={ROW_TEXT_CLASS}>-</span>
                        )}
                      </div>

                      {/* Run ID */}
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
              className='absolute top-0 right-0 bottom-0 flex flex-col border-[var(--border)] border-l bg-[var(--surface-1)]'
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
                className='group flex h-[30px] flex-shrink-0 cursor-pointer items-center justify-between bg-[var(--surface-1)] pr-[16px] pl-[10px]'
                onClick={handleHeaderClick}
              >
                <div className='flex items-center'>
                  <Button
                    variant='ghost'
                    className={clsx(
                      'px-[8px] py-[6px] text-[12px]',
                      !showInput ? '!text-[var(--text-primary)]' : '!text-[var(--text-tertiary)]'
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!isExpanded) {
                        expandToLastHeight()
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
                        showInput ? '!text-[var(--text-primary)]' : '!text-[var(--text-tertiary)]'
                      )}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!isExpanded) {
                          expandToLastHeight()
                        }
                        setShowInput(true)
                      }}
                      aria-label='Show input'
                    >
                      Input
                    </Button>
                  )}
                </div>
                <div className='flex flex-shrink-0 items-center gap-[8px]'>
                  {isOutputSearchActive ? (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          onClick={(e) => {
                            e.stopPropagation()
                            closeOutputSearch()
                          }}
                          aria-label='Search in output'
                          className='!p-1.5 -m-1.5'
                        >
                          <X className='h-[12px] w-[12px]' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        <span>Close search</span>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  ) : (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          onClick={(e) => {
                            e.stopPropagation()
                            activateOutputSearch()
                          }}
                          aria-label='Search in output'
                          className='!p-1.5 -m-1.5'
                        >
                          <Search className='h-[12px] w-[12px]' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        <span>Search</span>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  )}

                  {isPlaygroundEnabled && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Link href='/playground'>
                          <Button
                            variant='ghost'
                            aria-label='Component Playground'
                            className='!p-1.5 -m-1.5'
                          >
                            <Palette className='h-[12px] w-[12px]' />
                          </Button>
                        </Link>
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        <span>Component Playground</span>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  )}

                  {shouldShowTrainingButton && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          onClick={handleTrainingClick}
                          aria-label={isTraining ? 'Stop training' : 'Train Copilot'}
                          className={clsx(
                            '!p-1.5 -m-1.5',
                            isTraining && 'text-orange-600 dark:text-orange-400'
                          )}
                        >
                          {isTraining ? (
                            <Pause className='h-[12px] w-[12px]' />
                          ) : (
                            <Database className='h-[12px] w-[12px]' />
                          )}
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        <span>{isTraining ? 'Stop Training' : 'Train Copilot'}</span>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  )}

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
                          <Check className='h-[12px] w-[12px]' />
                        ) : (
                          <Clipboard className='h-[12px] w-[12px]' />
                        )}
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      <span>{showCopySuccess ? 'Copied' : 'Copy output'}</span>
                    </Tooltip.Content>
                  </Tooltip.Root>
                  {filteredEntries.length > 0 && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          onClick={handleExportConsole}
                          aria-label='Download console CSV'
                          className='!p-1.5 -m-1.5'
                        >
                          <ArrowDownToLine className='h-3 w-3' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        <span>Download CSV</span>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  )}
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
                        <Tooltip.Shortcut keys='⌘D'>Clear console</Tooltip.Shortcut>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  )}
                  <Popover open={outputOptionsOpen} onOpenChange={setOutputOptionsOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant='ghost'
                        onClick={(e) => {
                          e.stopPropagation()
                        }}
                        aria-label='Terminal options'
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
                      style={{ minWidth: '140px', maxWidth: '160px' }}
                      className='gap-[2px]'
                    >
                      <PopoverItem
                        active={wrapText}
                        showCheck
                        onClick={(e) => {
                          e.stopPropagation()
                          setWrapText(!wrapText)
                        }}
                      >
                        <span>Wrap text</span>
                      </PopoverItem>
                      <PopoverItem
                        active={openOnRun}
                        showCheck
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpenOnRun(!openOnRun)
                        }}
                      >
                        <span>Open on run</span>
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

              {/* Search Overlay */}
              {isOutputSearchActive && (
                <div
                  className='absolute top-[30px] right-[8px] z-30 flex h-[34px] items-center gap-[6px] rounded-b-[4px] border border-[var(--border)] border-t-0 bg-[var(--surface-1)] px-[6px] shadow-sm'
                  onClick={(e) => e.stopPropagation()}
                  data-toolbar-root
                  data-search-active='true'
                >
                  <Input
                    ref={outputSearchInputRef}
                    type='text'
                    value={outputSearchQuery}
                    onChange={(e) => setOutputSearchQuery(e.target.value)}
                    placeholder='Search...'
                    className='mr-[2px] h-[23px] w-[94px] text-[12px]'
                  />
                  <span
                    className={clsx(
                      'w-[58px] font-medium text-[11px]',
                      matchCount > 0
                        ? 'text-[var(--text-secondary)]'
                        : 'text-[var(--text-tertiary)]'
                    )}
                  >
                    {matchCount > 0 ? `${currentMatchIndex + 1}/${matchCount}` : 'No results'}
                  </span>
                  <Button
                    variant='ghost'
                    onClick={goToPreviousMatch}
                    aria-label='Previous match'
                    className='!p-1.5 -m-1.5'
                    disabled={matchCount === 0}
                  >
                    <ArrowUp className='h-[12px] w-[12px]' />
                  </Button>
                  <Button
                    variant='ghost'
                    onClick={goToNextMatch}
                    aria-label='Next match'
                    className='!p-1.5 -m-1.5'
                    disabled={matchCount === 0}
                  >
                    <ArrowDown className='h-[12px] w-[12px]' />
                  </Button>
                  <Button
                    variant='ghost'
                    onClick={closeOutputSearch}
                    aria-label='Close search'
                    className='!p-1.5 -m-1.5'
                  >
                    <X className='h-[12px] w-[12px]' />
                  </Button>
                </div>
              )}

              {/* Content */}
              <div
                className={clsx('flex-1 overflow-y-auto', !wrapText && 'overflow-x-auto')}
                onContextMenu={handleOutputPanelContextMenu}
              >
                {shouldShowCodeDisplay ? (
                  <OutputCodeContent
                    code={selectedEntry.input.code}
                    language={
                      (selectedEntry.input.language as 'javascript' | 'json') || 'javascript'
                    }
                    wrapText={wrapText}
                    searchQuery={isOutputSearchActive ? outputSearchQuery : undefined}
                    currentMatchIndex={currentMatchIndex}
                    onMatchCountChange={handleMatchCountChange}
                    contentRef={outputContentRef}
                  />
                ) : (
                  <OutputCodeContent
                    code={outputDataStringified}
                    language='json'
                    wrapText={wrapText}
                    searchQuery={isOutputSearchActive ? outputSearchQuery : undefined}
                    currentMatchIndex={currentMatchIndex}
                    onMatchCountChange={handleMatchCountChange}
                    contentRef={outputContentRef}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Log Row Context Menu */}
      <LogRowContextMenu
        isOpen={isLogRowMenuOpen}
        position={logRowMenuPosition}
        menuRef={logRowMenuRef}
        onClose={closeLogRowMenu}
        entry={contextMenuEntry}
        filters={filters}
        onFilterByBlock={handleFilterByBlock}
        onFilterByStatus={handleFilterByStatus}
        onFilterByRunId={handleFilterByRunId}
        onCopyRunId={handleCopyRunId}
        onClearFilters={() => {
          clearFilters()
          closeLogRowMenu()
        }}
        onClearConsole={handleClearConsoleFromMenu}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Output Panel Context Menu */}
      <OutputContextMenu
        isOpen={isOutputMenuOpen}
        position={outputMenuPosition}
        menuRef={outputMenuRef}
        onClose={closeOutputMenu}
        onCopySelection={handleCopySelection}
        onCopyAll={handleCopy}
        onSearch={activateOutputSearch}
        wrapText={wrapText}
        onToggleWrap={() => setWrapText(!wrapText)}
        openOnRun={openOnRun}
        onToggleOpenOnRun={() => setOpenOnRun(!openOnRun)}
        onClearConsole={handleClearConsoleFromMenu}
        hasSelection={hasSelection}
      />
    </>
  )
}
