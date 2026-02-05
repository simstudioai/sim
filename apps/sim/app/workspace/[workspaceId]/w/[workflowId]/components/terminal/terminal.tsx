'use client'

import type React from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Database,
  MoreHorizontal,
  Palette,
  Pause,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'
import {
  Button,
  ChevronDown,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Tooltip,
} from '@/components/emcn'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { formatDuration } from '@/lib/core/utils/formatting'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import {
  FilterPopover,
  LogRowContextMenu,
  OutputPanel,
  StatusDisplay,
  ToggleButton,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components'
import {
  useOutputPanelResize,
  useTerminalFilters,
  useTerminalResize,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/hooks'
import { ROW_STYLES } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/types'
import {
  type EntryNode,
  type ExecutionGroup,
  flattenBlockEntriesOnly,
  getBlockColor,
  getBlockIcon,
  groupEntriesByExecution,
  isEventFromEditableElement,
  type NavigableBlockEntry,
  TERMINAL_CONFIG,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/utils'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useShowTrainingControls } from '@/hooks/queries/general-settings'
import { OUTPUT_PANEL_WIDTH, TERMINAL_HEIGHT } from '@/stores/constants'
import { useCopilotTrainingStore } from '@/stores/copilot-training/store'
import { openCopilotWithMessage } from '@/stores/notifications/utils'
import type { ConsoleEntry } from '@/stores/terminal'
import { useTerminalConsoleStore, useTerminalStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * Terminal height configuration constants
 */
const MIN_HEIGHT = TERMINAL_HEIGHT.MIN
const DEFAULT_EXPANDED_HEIGHT = TERMINAL_HEIGHT.DEFAULT
const MIN_OUTPUT_PANEL_WIDTH_PX = OUTPUT_PANEL_WIDTH.MIN

/**
 * Block row component for displaying actual block entries
 */
const BlockRow = memo(function BlockRow({
  entry,
  isSelected,
  onSelect,
}: {
  entry: ConsoleEntry
  isSelected: boolean
  onSelect: (entry: ConsoleEntry) => void
}) {
  const BlockIcon = getBlockIcon(entry.blockType)
  const hasError = Boolean(entry.error)
  const isRunning = Boolean(entry.isRunning)
  const isCanceled = Boolean(entry.isCanceled)
  const bgColor = getBlockColor(entry.blockType)

  return (
    <div
      data-entry-id={entry.id}
      className={clsx(
        ROW_STYLES.base,
        'h-[26px]',
        isSelected ? ROW_STYLES.selected : ROW_STYLES.hover
      )}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(entry)
      }}
    >
      <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
        <div
          className='flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded-[4px]'
          style={{ background: bgColor }}
        >
          {BlockIcon && <BlockIcon className='h-[9px] w-[9px] text-white' />}
        </div>
        <span
          className={clsx(
            'min-w-0 truncate font-medium text-[13px]',
            hasError
              ? 'text-[var(--text-error)]'
              : isSelected
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]'
          )}
        >
          {entry.blockName}
        </span>
      </div>
      <span
        className={clsx(
          'flex-shrink-0 font-medium text-[13px]',
          !isRunning &&
            (isCanceled ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]')
        )}
      >
        <StatusDisplay
          isRunning={isRunning}
          isCanceled={isCanceled}
          formattedDuration={formatDuration(entry.durationMs, { precision: 2 }) ?? '-'}
        />
      </span>
    </div>
  )
})

/**
 * Iteration node component - shows iteration header with nested blocks
 */
const IterationNodeRow = memo(function IterationNodeRow({
  node,
  selectedEntryId,
  onSelectEntry,
  isExpanded,
  onToggle,
}: {
  node: EntryNode
  selectedEntryId: string | null
  onSelectEntry: (entry: ConsoleEntry) => void
  isExpanded: boolean
  onToggle: () => void
}) {
  const { entry, children, iterationInfo } = node
  const hasError = Boolean(entry.error) || children.some((c) => c.entry.error)
  const hasChildren = children.length > 0
  const hasRunningChild = children.some((c) => c.entry.isRunning)
  const hasCanceledChild = children.some((c) => c.entry.isCanceled) && !hasRunningChild

  const iterationLabel = iterationInfo
    ? `Iteration ${iterationInfo.current + 1}${iterationInfo.total !== undefined ? ` / ${iterationInfo.total}` : ''}`
    : entry.blockName

  return (
    <div className='flex min-w-0 flex-col'>
      {/* Iteration Header */}
      <div
        className={clsx(ROW_STYLES.base, 'h-[26px]', ROW_STYLES.hover)}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
          <span
            className={clsx(
              'min-w-0 truncate font-medium text-[13px]',
              hasError
                ? 'text-[var(--text-error)]'
                : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]'
            )}
          >
            {iterationLabel}
          </span>
          {hasChildren && (
            <ChevronDown
              className={clsx(
                'h-[8px] w-[8px] flex-shrink-0 text-[var(--text-tertiary)] transition-transform duration-100 group-hover:text-[var(--text-primary)]',
                !isExpanded && '-rotate-90'
              )}
            />
          )}
        </div>
        <span
          className={clsx(
            'flex-shrink-0 font-medium text-[13px]',
            !hasRunningChild &&
              (hasCanceledChild ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]')
          )}
        >
          <StatusDisplay
            isRunning={hasRunningChild}
            isCanceled={hasCanceledChild}
            formattedDuration={formatDuration(entry.durationMs, { precision: 2 }) ?? '-'}
          />
        </span>
      </div>

      {/* Nested Blocks */}
      {isExpanded && hasChildren && (
        <div className={ROW_STYLES.nested}>
          {children.map((child) => (
            <BlockRow
              key={child.entry.id}
              entry={child.entry}
              isSelected={selectedEntryId === child.entry.id}
              onSelect={onSelectEntry}
            />
          ))}
        </div>
      )}
    </div>
  )
})

/**
 * Subflow node component - shows subflow header with nested iterations
 */
const SubflowNodeRow = memo(function SubflowNodeRow({
  node,
  selectedEntryId,
  onSelectEntry,
  expandedNodes,
  onToggleNode,
}: {
  node: EntryNode
  selectedEntryId: string | null
  onSelectEntry: (entry: ConsoleEntry) => void
  expandedNodes: Set<string>
  onToggleNode: (nodeId: string) => void
}) {
  const { entry, children } = node
  const BlockIcon = getBlockIcon(entry.blockType)
  const hasError =
    Boolean(entry.error) ||
    children.some((c) => c.entry.error || c.children.some((gc) => gc.entry.error))
  const bgColor = getBlockColor(entry.blockType)
  const nodeId = entry.id
  const isExpanded = expandedNodes.has(nodeId)
  const hasChildren = children.length > 0

  // Check if any nested block is running or canceled
  const hasRunningDescendant = children.some(
    (c) => c.entry.isRunning || c.children.some((gc) => gc.entry.isRunning)
  )
  const hasCanceledDescendant =
    children.some((c) => c.entry.isCanceled || c.children.some((gc) => gc.entry.isCanceled)) &&
    !hasRunningDescendant

  const displayName =
    entry.blockType === 'loop'
      ? 'Loop'
      : entry.blockType === 'parallel'
        ? 'Parallel'
        : entry.blockName

  return (
    <div className='flex min-w-0 flex-col'>
      {/* Subflow Header */}
      <div
        className={clsx(ROW_STYLES.base, 'h-[26px]', ROW_STYLES.hover)}
        onClick={(e) => {
          e.stopPropagation()
          onToggleNode(nodeId)
        }}
      >
        <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
          <div
            className='flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded-[4px]'
            style={{ background: bgColor }}
          >
            {BlockIcon && <BlockIcon className='h-[9px] w-[9px] text-white' />}
          </div>
          <span
            className={clsx(
              'min-w-0 truncate font-medium text-[13px]',
              hasError
                ? 'text-[var(--text-error)]'
                : isExpanded
                  ? 'text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]'
            )}
          >
            {displayName}
          </span>
          {hasChildren && (
            <ChevronDown
              className={clsx(
                'h-[8px] w-[8px] flex-shrink-0 text-[var(--text-tertiary)] transition-transform duration-100 group-hover:text-[var(--text-primary)]',
                !isExpanded && '-rotate-90'
              )}
            />
          )}
        </div>
        <span
          className={clsx(
            'flex-shrink-0 font-medium text-[13px]',
            !hasRunningDescendant &&
              (hasCanceledDescendant
                ? 'text-[var(--text-secondary)]'
                : 'text-[var(--text-tertiary)]')
          )}
        >
          <StatusDisplay
            isRunning={hasRunningDescendant}
            isCanceled={hasCanceledDescendant}
            formattedDuration={formatDuration(entry.durationMs, { precision: 2 }) ?? '-'}
          />
        </span>
      </div>

      {/* Nested Iterations */}
      {isExpanded && hasChildren && (
        <div className={ROW_STYLES.nested}>
          {children.map((iterNode) => (
            <IterationNodeRow
              key={iterNode.entry.id}
              node={iterNode}
              selectedEntryId={selectedEntryId}
              onSelectEntry={onSelectEntry}
              isExpanded={expandedNodes.has(iterNode.entry.id)}
              onToggle={() => onToggleNode(iterNode.entry.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
})

/**
 * Entry node component - dispatches to appropriate component based on node type
 */
const EntryNodeRow = memo(function EntryNodeRow({
  node,
  selectedEntryId,
  onSelectEntry,
  expandedNodes,
  onToggleNode,
}: {
  node: EntryNode
  selectedEntryId: string | null
  onSelectEntry: (entry: ConsoleEntry) => void
  expandedNodes: Set<string>
  onToggleNode: (nodeId: string) => void
}) {
  const { nodeType } = node

  if (nodeType === 'subflow') {
    return (
      <SubflowNodeRow
        node={node}
        selectedEntryId={selectedEntryId}
        onSelectEntry={onSelectEntry}
        expandedNodes={expandedNodes}
        onToggleNode={onToggleNode}
      />
    )
  }

  if (nodeType === 'iteration') {
    return (
      <IterationNodeRow
        node={node}
        selectedEntryId={selectedEntryId}
        onSelectEntry={onSelectEntry}
        isExpanded={expandedNodes.has(node.entry.id)}
        onToggle={() => onToggleNode(node.entry.id)}
      />
    )
  }

  // Regular block
  return (
    <BlockRow
      entry={node.entry}
      isSelected={selectedEntryId === node.entry.id}
      onSelect={onSelectEntry}
    />
  )
})

/**
 * Execution group row component with dashed separator
 */
const ExecutionGroupRow = memo(function ExecutionGroupRow({
  group,
  showSeparator,
  selectedEntryId,
  onSelectEntry,
  expandedNodes,
  onToggleNode,
}: {
  group: ExecutionGroup
  showSeparator: boolean
  selectedEntryId: string | null
  onSelectEntry: (entry: ConsoleEntry) => void
  expandedNodes: Set<string>
  onToggleNode: (nodeId: string) => void
}) {
  return (
    <div className='flex flex-col px-[6px]'>
      {/* Separator between executions */}
      {showSeparator && <div className='mx-[4px] mb-[6px] border-[var(--border)] border-t' />}

      {/* Entry tree */}
      <div className='ml-[4px] flex flex-col gap-[2px] pb-[6px]'>
        {group.entryTree.map((node) => (
          <EntryNodeRow
            key={node.entry.id}
            node={node}
            selectedEntryId={selectedEntryId}
            onSelectEntry={onSelectEntry}
            expandedNodes={expandedNodes}
            onToggleNode={onToggleNode}
          />
        ))}
      </div>
    </div>
  )
})

/**
 * Terminal component with resizable height that persists across page refreshes.
 */
export const Terminal = memo(function Terminal() {
  const terminalRef = useRef<HTMLElement>(null)
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const prevWorkflowEntriesLengthRef = useRef(0)
  const hasInitializedEntriesRef = useRef(false)
  const isTerminalFocusedRef = useRef(false)
  const lastExpandedHeightRef = useRef<number>(DEFAULT_EXPANDED_HEIGHT)

  // Store refs for keyboard handler to avoid stale closures
  const selectedEntryRef = useRef<ConsoleEntry | null>(null)
  const navigableEntriesRef = useRef<NavigableBlockEntry[]>([])
  const showInputRef = useRef(false)
  const hasInputDataRef = useRef(false)
  const isExpandedRef = useRef(false)

  const setTerminalHeight = useTerminalStore((state) => state.setTerminalHeight)
  const outputPanelWidth = useTerminalStore((state) => state.outputPanelWidth)
  const setOutputPanelWidth = useTerminalStore((state) => state.setOutputPanelWidth)
  const openOnRun = useTerminalStore((state) => state.openOnRun)
  const setOpenOnRun = useTerminalStore((state) => state.setOpenOnRun)
  const setHasHydrated = useTerminalStore((state) => state.setHasHydrated)
  const isExpanded = useTerminalStore(
    (state) => state.terminalHeight > TERMINAL_CONFIG.NEAR_MIN_THRESHOLD
  )
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const hasConsoleHydrated = useTerminalConsoleStore((state) => state._hasHydrated)

  // Get all entries and filter in useMemo to avoid new array on every store update
  const allStoreEntries = useTerminalConsoleStore((state) => state.entries)
  const entries = useMemo(() => {
    if (!hasConsoleHydrated) return []
    return allStoreEntries.filter((entry) => entry.workflowId === activeWorkflowId)
  }, [allStoreEntries, activeWorkflowId, hasConsoleHydrated])

  const clearWorkflowConsole = useTerminalConsoleStore((state) => state.clearWorkflowConsole)
  const exportConsoleCSV = useTerminalConsoleStore((state) => state.exportConsoleCSV)

  const [selectedEntry, setSelectedEntry] = useState<ConsoleEntry | null>(null)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [isToggling, setIsToggling] = useState(false)
  const [showCopySuccess, setShowCopySuccess] = useState(false)
  const [showInput, setShowInput] = useState(false)
  const [autoSelectEnabled, setAutoSelectEnabled] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [mainOptionsOpen, setMainOptionsOpen] = useState(false)

  const [isTrainingEnvEnabled, setIsTrainingEnvEnabled] = useState(false)
  const showTrainingControls = useShowTrainingControls()
  const { isTraining, toggleModal: toggleTrainingModal, stopTraining } = useCopilotTrainingStore()

  const [isPlaygroundEnabled, setIsPlaygroundEnabled] = useState(false)

  const { handleMouseDown } = useTerminalResize()
  const { handleMouseDown: handleOutputPanelResizeMouseDown } = useOutputPanelResize()

  const {
    filters,
    sortConfig,
    toggleBlock,
    toggleStatus,
    toggleSort,
    clearFilters,
    filterEntries,
    hasActiveFilters,
  } = useTerminalFilters()

  const {
    isOpen: isLogRowMenuOpen,
    position: logRowMenuPosition,
    menuRef: logRowMenuRef,
    closeMenu: closeLogRowMenu,
  } = useContextMenu()

  /**
   * Expands the terminal to its last meaningful height
   */
  const expandToLastHeight = useCallback(() => {
    setIsToggling(true)
    const maxHeight = window.innerHeight * 0.7
    const desiredHeight = Math.max(
      lastExpandedHeightRef.current || DEFAULT_EXPANDED_HEIGHT,
      DEFAULT_EXPANDED_HEIGHT
    )
    const targetHeight = Math.min(desiredHeight, maxHeight)
    setTerminalHeight(targetHeight)
  }, [setTerminalHeight])

  const allWorkflowEntries = entries

  /**
   * Filter entries for current workflow and apply filters
   */
  const filteredEntries = useMemo(() => {
    return filterEntries(allWorkflowEntries)
  }, [allWorkflowEntries, filterEntries])

  /**
   * Group filtered entries by execution
   */
  const executionGroups = useMemo(() => {
    return groupEntriesByExecution(filteredEntries)
  }, [filteredEntries])

  /**
   * Navigable block entries for keyboard navigation.
   * Only includes actual block outputs (excludes subflow/iteration container nodes).
   * Includes parent node IDs for auto-expanding when navigating.
   */
  const navigableEntries = useMemo(() => {
    const result: NavigableBlockEntry[] = []
    for (const group of executionGroups) {
      result.push(...flattenBlockEntriesOnly(group.entryTree, group.executionId))
    }
    return result
  }, [executionGroups])

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

  // Keep refs in sync for keyboard handler
  useEffect(() => {
    selectedEntryRef.current = selectedEntry
    navigableEntriesRef.current = navigableEntries
    showInputRef.current = showInput
    hasInputDataRef.current = hasInputData
    isExpandedRef.current = isExpanded
  }, [selectedEntry, navigableEntries, showInput, hasInputData, isExpanded])

  /**
   * Reset entry tracking when switching workflows to ensure auto-open
   * works correctly for each workflow independently.
   */
  useEffect(() => {
    hasInitializedEntriesRef.current = false
  }, [activeWorkflowId])

  /**
   * Auto-open the terminal on new entries when "Open on run" is enabled.
   * This mirrors the header toggle behavior by using expandToLastHeight,
   * ensuring we always get the same smooth height transition.
   *
   * Skips the initial sync after console hydration to avoid auto-opening
   * when persisted entries are restored on page refresh.
   */
  useEffect(() => {
    if (!hasConsoleHydrated) {
      return
    }

    if (!hasInitializedEntriesRef.current) {
      hasInitializedEntriesRef.current = true
      prevWorkflowEntriesLengthRef.current = allWorkflowEntries.length
      return
    }

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
  }, [
    allWorkflowEntries.length,
    expandToLastHeight,
    openOnRun,
    isExpanded,
    hasConsoleHydrated,
    activeWorkflowId,
  ])

  /**
   * Auto-expand subflows and iterations when new entries arrive.
   * This always runs regardless of autoSelectEnabled - new runs should always be visible.
   */
  useEffect(() => {
    if (executionGroups.length === 0) return

    const newestExec = executionGroups[0]

    // Collect all node IDs that should be expanded (subflows and their iterations)
    const nodeIdsToExpand: string[] = []
    for (const node of newestExec.entryTree) {
      if (node.nodeType === 'subflow' && node.children.length > 0) {
        nodeIdsToExpand.push(node.entry.id)
        // Also expand all iteration children
        for (const iterNode of node.children) {
          if (iterNode.nodeType === 'iteration') {
            nodeIdsToExpand.push(iterNode.entry.id)
          }
        }
      }
    }

    if (nodeIdsToExpand.length > 0) {
      setExpandedNodes((prev) => {
        const hasAll = nodeIdsToExpand.every((id) => prev.has(id))
        if (hasAll) return prev
        const next = new Set(prev)
        nodeIdsToExpand.forEach((id) => next.add(id))
        return next
      })
    }
  }, [executionGroups])

  /**
   * Focus the terminal for keyboard navigation
   */
  const focusTerminal = useCallback(() => {
    terminalRef.current?.focus()
    isTerminalFocusedRef.current = true
  }, [])

  /**
   * Handle entry selection - clicking same entry toggles selection off
   */
  const handleSelectEntry = useCallback(
    (entry: ConsoleEntry) => {
      focusTerminal()
      setSelectedEntry((prev) => {
        // Disable auto-select on any manual selection/deselection
        setAutoSelectEnabled(false)
        return prev?.id === entry.id ? null : entry
      })
    },
    [focusTerminal]
  )

  /**
   * Toggle subflow node expansion
   */
  const handleToggleNode = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
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

  const handleTerminalFocus = useCallback(() => {
    isTerminalFocusedRef.current = true
  }, [])

  const handleTerminalBlur = useCallback((e: React.FocusEvent) => {
    if (!terminalRef.current?.contains(e.relatedTarget as Node)) {
      isTerminalFocusedRef.current = false
    }
  }, [])

  const handleCopy = useCallback(() => {
    if (!selectedEntry) return
    const textToCopy = shouldShowCodeDisplay ? selectedEntry.input.code : outputDataStringified
    navigator.clipboard.writeText(textToCopy)
    setShowCopySuccess(true)
  }, [selectedEntry, outputDataStringified, shouldShowCodeDisplay])

  const clearCurrentWorkflowConsole = useCallback(() => {
    if (activeWorkflowId) {
      clearWorkflowConsole(activeWorkflowId)
      setSelectedEntry(null)
      setExpandedNodes(new Set())
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

  const handleFixInCopilot = useCallback(
    (entry: ConsoleEntry) => {
      const errorMessage = entry.error ? String(entry.error) : 'Unknown error'
      const blockName = entry.blockName || 'Unknown Block'
      const message = `${errorMessage}\n\nError in ${blockName}.\n\nPlease fix this.`
      openCopilotWithMessage(message)
      closeLogRowMenu()
    },
    [closeLogRowMenu]
  )

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

  useEffect(() => {
    setHasHydrated(true)
  }, [setHasHydrated])

  useEffect(() => {
    lastExpandedHeightRef.current = useTerminalStore.getState().lastExpandedHeight
    const unsub = useTerminalStore.subscribe((state) => {
      lastExpandedHeightRef.current = state.lastExpandedHeight
    })
    return unsub
  }, [])

  useEffect(() => {
    setIsTrainingEnvEnabled(isTruthy(getEnv('NEXT_PUBLIC_COPILOT_TRAINING_ENABLED')))
    setIsPlaygroundEnabled(isTruthy(getEnv('NEXT_PUBLIC_ENABLE_PLAYGROUND')))
  }, [])

  useEffect(() => {
    if (!selectedEntry) {
      setShowInput(false)
      return
    }
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

  useEffect(() => {
    if (showCopySuccess) {
      const timer = setTimeout(() => {
        setShowCopySuccess(false)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [showCopySuccess])

  const scrollEntryIntoView = useCallback((entryId: string) => {
    const container = logsContainerRef.current
    if (!container) return
    const el = container.querySelector(`[data-entry-id="${entryId}"]`)
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [])

  useEffect(() => {
    if (executionGroups.length === 0 || navigableEntries.length === 0) {
      setAutoSelectEnabled(true)
      setSelectedEntry(null)
      return
    }

    if (!autoSelectEnabled) return

    const newestExecutionId = executionGroups[0].executionId
    let lastNavEntry: NavigableBlockEntry | null = null

    for (const navEntry of navigableEntries) {
      if (navEntry.executionId === newestExecutionId) {
        lastNavEntry = navEntry
      } else {
        break
      }
    }

    if (!lastNavEntry) return
    if (selectedEntry?.id === lastNavEntry.entry.id) return

    setSelectedEntry(lastNavEntry.entry)
    focusTerminal()

    if (lastNavEntry.parentNodeIds.length > 0) {
      setExpandedNodes((prev) => {
        const hasAll = lastNavEntry.parentNodeIds.every((id) => prev.has(id))
        if (hasAll) return prev
        const next = new Set(prev)
        lastNavEntry.parentNodeIds.forEach((id) => next.add(id))
        return next
      })
    }
  }, [executionGroups, navigableEntries, autoSelectEnabled, selectedEntry?.id, focusTerminal])

  useEffect(() => {
    if (selectedEntry) {
      scrollEntryIntoView(selectedEntry.id)
    }
  }, [selectedEntry?.id, scrollEntryIntoView])

  /**
   * Sync selected entry with latest data from store.
   * This ensures the output panel updates when a running block completes or is canceled.
   */
  useEffect(() => {
    if (!selectedEntry) return

    const updatedEntry = filteredEntries.find((e) => e.id === selectedEntry.id)
    if (updatedEntry && updatedEntry !== selectedEntry) {
      // Only update if the entry data has actually changed
      const hasChanged =
        updatedEntry.output !== selectedEntry.output ||
        updatedEntry.isRunning !== selectedEntry.isRunning ||
        updatedEntry.isCanceled !== selectedEntry.isCanceled ||
        updatedEntry.durationMs !== selectedEntry.durationMs ||
        updatedEntry.error !== selectedEntry.error ||
        updatedEntry.success !== selectedEntry.success
      if (hasChanged) {
        setSelectedEntry(updatedEntry)
      }
    }
  }, [filteredEntries, selectedEntry])

  /**
   * Clear filters when there are no logs
   */
  useEffect(() => {
    if (allWorkflowEntries.length === 0 && hasActiveFilters) {
      clearFilters()
    }
  }, [allWorkflowEntries.length, hasActiveFilters, clearFilters])

  /**
   * Navigate to a block entry and auto-expand its parents
   */
  const navigateToEntry = useCallback(
    (navEntry: NavigableBlockEntry) => {
      setAutoSelectEnabled(false)
      setSelectedEntry(navEntry.entry)

      // Auto-expand parent nodes (subflows, iterations)
      if (navEntry.parentNodeIds.length > 0) {
        setExpandedNodes((prev) => {
          const hasAll = navEntry.parentNodeIds.every((id) => prev.has(id))
          if (hasAll) return prev
          const next = new Set(prev)
          navEntry.parentNodeIds.forEach((id) => next.add(id))
          return next
        })
      }

      // Keep terminal focused for continued navigation
      focusTerminal()

      // Scroll entry into view if needed
      scrollEntryIntoView(navEntry.entry.id)
    },
    [focusTerminal, scrollEntryIntoView]
  )

  /**
   * Consolidated keyboard handler for all terminal navigation
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Common guards
      if (isEventFromEditableElement(e)) return

      const activeElement = document.activeElement as HTMLElement | null
      const searchOverlay = document.querySelector('[data-toolbar-root][data-search-active="true"]')
      if (searchOverlay && activeElement && searchOverlay.contains(activeElement)) {
        return
      }

      const currentEntry = selectedEntryRef.current
      const entries = navigableEntriesRef.current

      // Escape to unselect
      if (e.key === 'Escape') {
        if (currentEntry) {
          e.preventDefault()
          setSelectedEntry(null)
          setAutoSelectEnabled(true)
        }
        return
      }

      // Terminal must be focused for arrow keys
      if (!isTerminalFocusedRef.current) return

      // Arrow up/down for entry navigation (only block outputs)
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (entries.length === 0) return

        e.preventDefault()

        // If no entry selected, select the first or last based on direction
        if (!currentEntry) {
          const targetEntry = e.key === 'ArrowDown' ? entries[0] : entries[entries.length - 1]
          navigateToEntry(targetEntry)
          return
        }

        const currentIndex = entries.findIndex((navEntry) => navEntry.entry.id === currentEntry.id)
        if (currentIndex === -1) {
          // Current entry not in navigable list (shouldn't happen), select first
          navigateToEntry(entries[0])
          return
        }

        if (e.key === 'ArrowUp' && currentIndex > 0) {
          navigateToEntry(entries[currentIndex - 1])
        } else if (e.key === 'ArrowDown' && currentIndex < entries.length - 1) {
          navigateToEntry(entries[currentIndex + 1])
        }
        return
      }

      // Arrow left/right for input/output toggle
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!currentEntry) return

        e.preventDefault()

        if (!isExpandedRef.current) {
          expandToLastHeight()
        }

        if (e.key === 'ArrowLeft' && showInputRef.current) {
          setShowInput(false)
        } else if (e.key === 'ArrowRight' && !showInputRef.current && hasInputDataRef.current) {
          setShowInput(true)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [expandToLastHeight, navigateToEntry])

  /**
   * Adjust output panel width on resize.
   * Closes the output panel if there's not enough space for the minimum width.
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
      const maxWidth = terminalWidth - TERMINAL_CONFIG.BLOCK_COLUMN_WIDTH_PX

      // Close output panel if there's not enough space for minimum width
      if (maxWidth < MIN_OUTPUT_PANEL_WIDTH_PX) {
        setAutoSelectEnabled(false)
        setSelectedEntry(null)
        return
      }

      if (outputPanelWidth > maxWidth) {
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
        onFocus={handleTerminalFocus}
        onBlur={handleTerminalBlur}
        tabIndex={-1}
        aria-label='Terminal'
      >
        <div className='relative flex h-full border-[var(--border)] border-t'>
          {/* Left Section - Logs */}
          <div
            className={clsx('flex flex-col', !selectedEntry && 'flex-1')}
            style={selectedEntry ? { width: `calc(100% - ${outputPanelWidth}px)` } : undefined}
          >
            {/* Header */}
            <div
              className='group flex h-[30px] flex-shrink-0 cursor-pointer items-center justify-between bg-[var(--surface-1)] pr-[16px] pl-[16px]'
              onClick={handleHeaderClick}
            >
              {/* Left side - Logs label */}
              <span className={TERMINAL_CONFIG.HEADER_TEXT_CLASS}>Logs</span>

              {/* Right side - Filters and icons */}
              {!selectedEntry && (
                <div className='flex items-center gap-[8px]'>
                  {/* Unified filter popover */}
                  {allWorkflowEntries.length > 0 && (
                    <FilterPopover
                      open={filtersOpen}
                      onOpenChange={setFiltersOpen}
                      filters={filters}
                      toggleStatus={toggleStatus}
                      toggleBlock={toggleBlock}
                      uniqueBlocks={uniqueBlocks}
                      hasActiveFilters={hasActiveFilters}
                    />
                  )}

                  {/* Sort toggle */}
                  {allWorkflowEntries.length > 0 && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleSort()
                          }}
                          aria-label='Sort by timestamp'
                          className='!p-1.5 -m-1.5'
                        >
                          {sortConfig.direction === 'desc' ? (
                            <ArrowDown className='h-3 w-3' />
                          ) : (
                            <ArrowUp className='h-3 w-3' />
                          )}
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        <span>Sort by time</span>
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

                  <Popover open={mainOptionsOpen} onOpenChange={setMainOptionsOpen} size='sm'>
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
                        showCheck={openOnRun}
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

            {/* Execution list */}
            <div ref={logsContainerRef} className='flex-1 overflow-y-auto overflow-x-hidden'>
              {executionGroups.length === 0 ? (
                <div className='flex h-full items-center justify-center text-[#8D8D8D] text-[13px]'>
                  No logs yet
                </div>
              ) : (
                executionGroups.map((group, index) => (
                  <ExecutionGroupRow
                    key={group.executionId}
                    group={group}
                    showSeparator={index > 0}
                    selectedEntryId={selectedEntry?.id || null}
                    onSelectEntry={handleSelectEntry}
                    expandedNodes={expandedNodes}
                    onToggleNode={handleToggleNode}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right Section - Block Output (Overlay) */}
          {selectedEntry && (
            <OutputPanel
              selectedEntry={selectedEntry}
              handleOutputPanelResizeMouseDown={handleOutputPanelResizeMouseDown}
              handleHeaderClick={handleHeaderClick}
              isExpanded={isExpanded}
              expandToLastHeight={expandToLastHeight}
              showInput={showInput}
              setShowInput={setShowInput}
              hasInputData={hasInputData}
              isPlaygroundEnabled={isPlaygroundEnabled}
              shouldShowTrainingButton={shouldShowTrainingButton}
              isTraining={isTraining}
              handleTrainingClick={handleTrainingClick}
              showCopySuccess={showCopySuccess}
              handleCopy={handleCopy}
              filteredEntries={filteredEntries}
              handleExportConsole={handleExportConsole}
              hasActiveFilters={hasActiveFilters}
              handleClearConsole={handleClearConsole}
              shouldShowCodeDisplay={shouldShowCodeDisplay}
              outputDataStringified={outputDataStringified}
              outputData={outputData}
              handleClearConsoleFromMenu={handleClearConsoleFromMenu}
              filters={filters}
              toggleBlock={toggleBlock}
              toggleStatus={toggleStatus}
              uniqueBlocks={uniqueBlocks}
            />
          )}
        </div>
      </aside>

      {/* Log Row Context Menu */}
      <LogRowContextMenu
        isOpen={isLogRowMenuOpen}
        position={logRowMenuPosition}
        menuRef={logRowMenuRef}
        onClose={closeLogRowMenu}
        entry={selectedEntry}
        filters={filters}
        onFilterByBlock={handleFilterByBlock}
        onFilterByStatus={handleFilterByStatus}
        onCopyRunId={handleCopyRunId}
        onClearConsole={handleClearConsoleFromMenu}
        onFixInCopilot={handleFixInCopilot}
      />
    </>
  )
})
