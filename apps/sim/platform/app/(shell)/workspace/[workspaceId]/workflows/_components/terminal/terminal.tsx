'use client'

import {
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { IconButton } from '@sim/emcn/button'
import { useClipboard } from '@sim/emcn/feedback/use-clipboard'
import { ActionMenu, type MenuAction, PointActionMenu } from '@sim/emcn/menu/action-menu'
import { useRegisterGlobalCommands } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/global-commands/global-commands'
import { ResizeHandle } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/resize-handle/resize-handle'
import { LogList } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/terminal/log-list/log-list'
import { OutputPanel } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/terminal/output-panel/output-panel'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/terminal/terminal.module.css'
import {
  ToggleButton,
  toggleFromHeader,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/terminal/toggle-button/toggle-button'
import {
  type ConsoleEntry,
  collectExpandableNodeIds,
  flattenBlockEntriesOnly,
  groupEntriesByExecution,
  isEventFromEditableElement,
  isMobileViewport,
  type NavigableBlockEntry,
  OUTPUT_PANEL_WIDTH,
  TERMINAL_CONFIG,
  useConsoleEntry,
  useTerminalConsoleStore,
  useTerminalFilters,
  useTerminalStore,
  useWorkflowConsoleEntries,
} from '@/platform/lib/data/workflow-deploy/terminal'
import {
  createCommand,
  isMacPlatform,
  sendMothershipMessage,
  TERMINAL_HEIGHT,
  useDeploymentShape,
  useIsMobile,
  useWorkflowRegistry,
} from '@/platform/lib/data/workflows'

type EntryStatus = 'error' | 'info'

/** The legacy height clamp: at least the minimum, at most 70% of the window. */
function clampTerminalHeight(height: number) {
  const max = Math.max(TERMINAL_HEIGHT.MIN, window.innerHeight * TERMINAL_HEIGHT.MAX_PERCENTAGE)
  return Math.min(Math.max(height, TERMINAL_HEIGHT.MIN), max)
}

/** Adds the given node ids to the open set, keeping its identity when nothing is new. */
function withExpanded(previous: Set<string>, ids: readonly string[]) {
  if (ids.every((id) => previous.has(id))) return previous
  const next = new Set(previous)
  for (const id of ids) next.add(id)
  return next
}

/**
 * Follows a pointer drag on a resize handle one frame at a time, writing the size straight to the
 * element so the drag renders nothing, then commits the last size once on release.
 */
function trackDrag(
  event: PointerEvent<HTMLDivElement>,
  measure: (pointer: globalThis.PointerEvent) => number,
  apply: (size: number) => void,
  commit: (size: number) => void
) {
  event.preventDefault()
  const handle = event.currentTarget
  const pointerId = event.pointerId
  handle.setPointerCapture(pointerId)
  let last: globalThis.PointerEvent | null = null
  let size: number | null = null
  let frame = 0
  const flush = () => {
    frame = 0
    if (!last) return
    size = measure(last)
    apply(size)
  }
  const move = (moveEvent: globalThis.PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return
    last = moveEvent
    if (!frame) frame = requestAnimationFrame(flush)
  }
  const end = (endEvent: globalThis.PointerEvent) => {
    if (endEvent.pointerId !== pointerId) return
    if (frame) cancelAnimationFrame(frame)
    flush()
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    if (size !== null) commit(size)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
}

/**
 * The editor's Terminal, docked beneath the canvas: this workflow's runs from the console store
 * (kept in IndexedDB across reloads), newest first, grouped by run with Loop, Parallel, iteration
 * and child-workflow rows; the selected block's output beside them; resizable, collapsible and
 * opening on a new run when Open on run is set. Mod+D clears it.
 */
export function Terminal() {
  const isMobile = useIsMobile()
  const terminalRef = useRef<HTMLElement>(null)
  const outputPanelRef = useRef<HTMLDivElement>(null)
  const isTerminalFocusedRef = useRef(false)
  const prevEntriesLengthRef = useRef(0)
  const hasInitializedEntriesRef = useRef(false)

  const terminalHeight = useTerminalStore((state) => state.terminalHeight)
  const setTerminalHeight = useTerminalStore((state) => state.setTerminalHeight)
  const outputPanelWidth = useTerminalStore((state) => state.outputPanelWidth)
  const setOutputPanelWidth = useTerminalStore((state) => state.setOutputPanelWidth)
  const openOnRun = useTerminalStore((state) => state.openOnRun)
  const setOpenOnRun = useTerminalStore((state) => state.setOpenOnRun)
  const setHasHydrated = useTerminalStore((state) => state.setHasHydrated)
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const hasConsoleHydrated = useTerminalConsoleStore((state) => state._hasHydrated)
  const clearWorkflowConsole = useTerminalConsoleStore((state) => state.clearWorkflowConsole)
  const exportConsoleCSV = useTerminalConsoleStore((state) => state.exportConsoleCSV)
  const entries = useWorkflowConsoleEntries(
    hasConsoleHydrated && typeof activeWorkflowId === 'string' ? activeWorkflowId : undefined
  )
  const { chatEnabled } = useDeploymentShape()
  const { copy } = useClipboard()

  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const selectedEntry = useConsoleEntry(selectedEntryId)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set())
  const [isToggling, setIsToggling] = useState(false)
  const [showInput, setShowInput] = useState(false)
  const [autoSelectEnabled, setAutoSelectEnabled] = useState(true)
  const [isMobileExpanded, setIsMobileExpanded] = useState(false)
  const [rowMenu, setRowMenu] = useState<{ entry: ConsoleEntry; x: number; y: number } | null>(null)
  const isExpanded = isMobile
    ? isMobileExpanded
    : terminalHeight > TERMINAL_CONFIG.NEAR_MIN_THRESHOLD

  const {
    filters,
    sortDirection,
    toggleBlock,
    toggleStatus,
    toggleSort,
    clearFilters,
    filterEntries,
    hasActiveFilters,
  } = useTerminalFilters()

  const filteredEntries = useMemo(() => filterEntries(entries), [entries, filterEntries])
  const executionGroups = useMemo(() => groupEntriesByExecution(filteredEntries), [filteredEntries])
  const navigableEntries = useMemo(() => {
    const result: NavigableBlockEntry[] = []
    for (const group of executionGroups) {
      result.push(...flattenBlockEntriesOnly(group.entryTree, group.executionId))
    }
    return result
  }, [executionGroups])
  const autoExpandNodeIds = useMemo(
    () =>
      executionGroups.length > 0 ? collectExpandableNodeIds(executionGroups[0].entryTree) : [],
    [executionGroups]
  )
  const hasInputData = useMemo(() => {
    const input: unknown = selectedEntry?.input
    if (!input) return false
    return typeof input === 'object' ? Object.keys(input).length > 0 : true
  }, [selectedEntry])

  const selectedEntryRef = useRef(selectedEntry)
  const navigableEntriesRef = useRef(navigableEntries)
  const showInputRef = useRef(showInput)
  const hasInputDataRef = useRef(hasInputData)
  const isExpandedRef = useRef(isExpanded)
  selectedEntryRef.current = selectedEntry
  navigableEntriesRef.current = navigableEntries
  showInputRef.current = showInput
  hasInputDataRef.current = hasInputData
  isExpandedRef.current = isExpanded

  const expandToLastHeight = useCallback(() => {
    if (isMobileViewport()) {
      setIsMobileExpanded(true)
      return
    }
    setIsToggling(true)
    const desired = Math.max(
      useTerminalStore.getState().lastExpandedHeight || TERMINAL_HEIGHT.DEFAULT,
      TERMINAL_HEIGHT.DEFAULT
    )
    setTerminalHeight(Math.min(desired, window.innerHeight * TERMINAL_HEIGHT.MAX_PERCENTAGE))
  }, [setTerminalHeight])

  const toggleExpanded = useCallback(() => {
    if (isMobileViewport()) {
      setIsMobileExpanded((expanded) => !expanded)
      return
    }
    if (isExpandedRef.current) {
      setIsToggling(true)
      setTerminalHeight(TERMINAL_HEIGHT.MIN)
    } else expandToLastHeight()
  }, [expandToLastHeight, setTerminalHeight])

  // The store's height sizes the dock; a phone folds it to its header or a fixed share instead.
  useLayoutEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    if (isMobile) terminal.style.removeProperty('block-size')
    else terminal.style.setProperty('block-size', `${terminalHeight}px`)
  }, [terminalHeight, isMobile])

  const hasSelection = Boolean(selectedEntry)
  useLayoutEffect(() => {
    const panel = outputPanelRef.current
    if (!panel) return
    if (isMobile) panel.style.removeProperty('inline-size')
    else panel.style.setProperty('inline-size', `${outputPanelWidth}px`)
  }, [outputPanelWidth, isMobile, hasSelection])

  const prevActiveWorkflowIdRef = useRef(activeWorkflowId)
  if (prevActiveWorkflowIdRef.current !== activeWorkflowId) {
    prevActiveWorkflowIdRef.current = activeWorkflowId
    hasInitializedEntriesRef.current = false
  }

  // Open on run: a new entry opens the folded terminal. Restored entries after a reload do not.
  useEffect(() => {
    if (!hasConsoleHydrated) return
    if (!hasInitializedEntriesRef.current) {
      hasInitializedEntriesRef.current = true
      prevEntriesLengthRef.current = entries.length
      return
    }
    if (openOnRun && entries.length > prevEntriesLengthRef.current && !isExpanded) {
      expandToLastHeight()
    }
    prevEntriesLengthRef.current = entries.length
  }, [
    entries.length,
    expandToLastHeight,
    openOnRun,
    isExpanded,
    hasConsoleHydrated,
    activeWorkflowId,
  ])

  // The newest run's Loops, Parallels, iterations and child workflows open as they arrive.
  useEffect(() => {
    if (autoExpandNodeIds.length === 0) return
    const frame = requestAnimationFrame(() => {
      setExpandedNodes((previous) => withExpanded(previous, autoExpandNodeIds))
    })
    return () => cancelAnimationFrame(frame)
  }, [autoExpandNodeIds])

  const focusTerminal = useCallback(() => {
    terminalRef.current?.focus({ preventScroll: true })
    isTerminalFocusedRef.current = true
  }, [])

  const handleSelectEntry = useCallback(
    (entry: ConsoleEntry) => {
      focusTerminal()
      setAutoSelectEnabled(false)
      setSelectedEntryId((previous) => (previous === entry.id ? null : entry.id))
    },
    [focusTerminal]
  )

  const handleToggleNode = useCallback((nodeId: string) => {
    setExpandedNodes((previous) => {
      const next = new Set(previous)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])

  const handleBackToLogs = useCallback(() => {
    setAutoSelectEnabled(false)
    setSelectedEntryId(null)
  }, [])

  const clearCurrentWorkflowConsole = useCallback(() => {
    if (!activeWorkflowId) return
    clearWorkflowConsole(activeWorkflowId)
    setSelectedEntryId(null)
    setExpandedNodes(new Set())
  }, [activeWorkflowId, clearWorkflowConsole])

  const exportConsole = useCallback(() => {
    if (activeWorkflowId) exportConsoleCSV(activeWorkflowId)
  }, [activeWorkflowId, exportConsoleCSV])

  const handleRowContextMenu = useCallback((entry: ConsoleEntry, event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const bounds = event.currentTarget.getBoundingClientRect()
    const pointer = event.clientX !== 0 || event.clientY !== 0
    setRowMenu({
      entry,
      x: pointer ? event.clientX : bounds.left,
      y: pointer ? event.clientY : bounds.bottom,
    })
  }, [])

  useRegisterGlobalCommands(() => [
    createCommand({
      id: 'clear-terminal-console',
      handler: () => clearCurrentWorkflowConsole(),
      overrides: { allowInEditable: false },
    }),
  ])

  useEffect(() => {
    setHasHydrated(true)
  }, [setHasHydrated])

  useEffect(() => {
    if (!selectedEntry) {
      setShowInput(false)
      return
    }
    if (showInput && !hasInputData) setShowInput(false)
  }, [selectedEntry, showInput, hasInputData])

  // Until the reader picks a row, the newest run's last block stays selected.
  useEffect(() => {
    if (executionGroups.length === 0 || navigableEntries.length === 0) {
      setAutoSelectEnabled(true)
      setSelectedEntryId(null)
      return
    }
    if (!autoSelectEnabled) return
    const newestExecutionId = executionGroups[0].executionId
    let last: NavigableBlockEntry | null = null
    for (const navEntry of navigableEntries) {
      if (navEntry.executionId !== newestExecutionId) break
      last = navEntry
    }
    if (!last || selectedEntryId === last.entry.id) return
    setSelectedEntryId(last.entry.id)
    const parents = last.parentNodeIds
    if (parents.length > 0) setExpandedNodes((previous) => withExpanded(previous, parents))
  }, [executionGroups, navigableEntries, autoSelectEnabled, selectedEntryId])

  useEffect(() => {
    if (entries.length === 0 && hasActiveFilters) clearFilters()
  }, [entries.length, hasActiveFilters, clearFilters])

  const navigateToEntry = useCallback(
    (navEntry: NavigableBlockEntry) => {
      setAutoSelectEnabled(false)
      setSelectedEntryId(navEntry.entry.id)
      const parents = navEntry.parentNodeIds
      if (parents.length > 0) setExpandedNodes((previous) => withExpanded(previous, parents))
      focusTerminal()
    },
    [focusTerminal]
  )

  // Escape releases the selection; while the terminal has focus the arrows step through blocks
  // (up and down) and switch between output and input (left and right).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEventFromEditableElement(event)) return
      const current = selectedEntryRef.current
      const list = navigableEntriesRef.current
      if (event.key === 'Escape') {
        if (current) {
          event.preventDefault()
          setSelectedEntryId(null)
          setAutoSelectEnabled(true)
        }
        return
      }
      if (!isTerminalFocusedRef.current) return
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        if (list.length === 0) return
        event.preventDefault()
        if (!current) {
          navigateToEntry(event.key === 'ArrowDown' ? list[0] : list[list.length - 1])
          return
        }
        const index = list.findIndex((navEntry) => navEntry.entry.id === current.id)
        if (index === -1) navigateToEntry(list[0])
        else if (event.key === 'ArrowUp' && index > 0) navigateToEntry(list[index - 1])
        else if (event.key === 'ArrowDown' && index < list.length - 1)
          navigateToEntry(list[index + 1])
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (!current) return
        event.preventDefault()
        if (!isExpandedRef.current) expandToLastHeight()
        if (event.key === 'ArrowLeft' && showInputRef.current) setShowInput(false)
        else if (event.key === 'ArrowRight' && !showInputRef.current && hasInputDataRef.current) {
          setShowInput(true)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [expandToLastHeight, navigateToEntry])

  // The output panel keeps the logs at least their block column wide, and closes when it cannot.
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal || isMobile || !hasSelection) return
    const fit = () => {
      if (isMobileViewport()) return
      const maxWidth =
        terminal.getBoundingClientRect().width - TERMINAL_CONFIG.BLOCK_COLUMN_WIDTH_PX
      if (maxWidth < OUTPUT_PANEL_WIDTH.MIN) {
        setAutoSelectEnabled(false)
        setSelectedEntryId(null)
        return
      }
      if (useTerminalStore.getState().outputPanelWidth > maxWidth) {
        setOutputPanelWidth(Math.max(maxWidth, OUTPUT_PANEL_WIDTH.MIN))
      }
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(terminal)
    return () => observer.disconnect()
  }, [hasSelection, isMobile, setOutputPanelWidth])

  const startTerminalResize = (event: PointerEvent<HTMLDivElement>) => {
    const terminal = terminalRef.current
    if (!terminal) return
    const bottom = terminal.getBoundingClientRect().bottom
    trackDrag(
      event,
      (pointer) => clampTerminalHeight(bottom - pointer.clientY),
      (height) => {
        terminal.style.setProperty('block-size', `${height}px`)
        // Crossing the folded threshold flips the chevron and Open on run mid-drag, as in legacy.
        const wasExpanded =
          useTerminalStore.getState().terminalHeight > TERMINAL_CONFIG.NEAR_MIN_THRESHOLD
        if (wasExpanded !== height > TERMINAL_CONFIG.NEAR_MIN_THRESHOLD) {
          useTerminalStore.setState({ terminalHeight: height })
        }
      },
      setTerminalHeight
    )
  }

  const startOutputResize = (event: PointerEvent<HTMLDivElement>) => {
    const terminal = terminalRef.current
    const panel = outputPanelRef.current
    if (!terminal || !panel) return
    trackDrag(
      event,
      (pointer) => {
        const bounds = terminal.getBoundingClientRect()
        const maxWidth = bounds.width - TERMINAL_CONFIG.BLOCK_COLUMN_WIDTH_PX
        return Math.max(OUTPUT_PANEL_WIDTH.MIN, Math.min(bounds.right - pointer.clientX, maxWidth))
      },
      (width) => panel.style.setProperty('inline-size', `${width}px`),
      setOutputPanelWidth
    )
  }

  const clearLabel = `Clear console (${isMacPlatform() ? '⌘' : 'Ctrl+'}D)`
  const terminalActions: MenuAction[] = [
    {
      id: 'open-on-run',
      label: 'Open on run',
      checked: openOnRun,
      onSelect: () => setOpenOnRun(!openOnRun),
    },
  ]

  const rowMenuActions = (): MenuAction[] => {
    if (!rowMenu) return []
    const { entry } = rowMenu
    const status: EntryStatus = entry.success ? 'info' : 'error'
    const actions: MenuAction[] = []
    if (entry.executionId != null) {
      const runId = entry.executionId
      actions.push({ id: 'copy-run-id', label: 'Copy run ID', onSelect: () => void copy(runId) })
    }
    if (chatEnabled && !entry.success) {
      actions.push({
        id: 'fix-in-chat',
        label: 'Fix in chat',
        separatorBefore: actions.length > 0,
        onSelect: () => {
          const error = entry.error ? String(entry.error) : 'Unknown error'
          sendMothershipMessage({
            content: `${error}\n\nError in ${entry.blockName || 'Unknown Block'}.\n\nPlease fix this.`,
          })
        },
      })
    }
    actions.push(
      {
        id: 'filter-block',
        label: 'Filter by block',
        checked: filters.blockIds.has(entry.blockId),
        separatorBefore: actions.length > 0,
        onSelect: () => toggleBlock(entry.blockId),
      },
      {
        id: 'filter-status',
        label: 'Filter by status',
        checked: filters.statuses.has(status),
        onSelect: () => toggleStatus(status),
      },
      {
        id: 'clear',
        label: 'Clear console',
        separatorBefore: true,
        onSelect: clearCurrentWorkflowConsole,
      }
    )
    return actions
  }

  return (
    <aside
      ref={terminalRef}
      className={styles.terminal}
      data-toggling={isToggling || undefined}
      data-mobile={isMobile || undefined}
      data-expanded={isExpanded || undefined}
      tabIndex={-1}
      aria-label='Terminal'
      onTransitionEnd={() => setIsToggling(false)}
      onFocus={() => {
        isTerminalFocusedRef.current = true
      }}
      onBlur={(event: FocusEvent) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !terminalRef.current?.contains(event.relatedTarget)
        ) {
          isTerminalFocusedRef.current = false
        }
      }}
    >
      {!isMobile && (
        <ResizeHandle
          edge='block-start'
          label='Resize terminal'
          onPointerDown={startTerminalResize}
        />
      )}
      <div className={styles.body}>
        <div className={styles.logs} data-covered={(isMobile && hasSelection) || undefined}>
          <div className={styles.header} onClick={toggleFromHeader(toggleExpanded)}>
            <span className={styles.title} data-type='T060'>
              Logs
            </span>
            {!selectedEntry && (
              <div className={styles.actions}>
                {entries.length > 0 && (
                  <IconButton
                    label='Sort by time'
                    icon={sortDirection === 'desc' ? 'I102' : 'I023'}
                    size='compact'
                    tooltip
                    onClick={toggleSort}
                  />
                )}
                {filteredEntries.length > 0 && (
                  <>
                    <IconButton
                      label='Export console CSV'
                      icon='I049'
                      size='compact'
                      tooltip
                      onClick={exportConsole}
                    />
                    <IconButton
                      label={clearLabel}
                      icon='trash'
                      size='compact'
                      tooltip
                      onClick={clearCurrentWorkflowConsole}
                    />
                  </>
                )}
                <ActionMenu
                  label='Terminal options'
                  icon='I108'
                  triggerSize='compact'
                  align='end'
                  actions={terminalActions}
                />
                <ToggleButton isExpanded={isExpanded} onToggle={toggleExpanded} />
              </div>
            )}
          </div>
          {executionGroups.length === 0 ? (
            hasConsoleHydrated && (
              <p className={styles.empty} data-type='T060'>
                No logs yet
              </p>
            )
          ) : (
            <LogList
              executionGroups={executionGroups}
              selectedEntryId={selectedEntryId}
              expandedNodes={expandedNodes}
              onSelectEntry={handleSelectEntry}
              onToggleNode={handleToggleNode}
              onContextMenu={handleRowContextMenu}
            />
          )}
        </div>
        {selectedEntry && (
          <OutputPanel
            panelRef={outputPanelRef}
            selectedEntry={selectedEntry}
            isExpanded={isExpanded}
            isMobile={isMobile}
            showInput={showInput}
            hasInputData={hasInputData}
            hasEntries={filteredEntries.length > 0}
            terminalActions={terminalActions}
            clearLabel={clearLabel}
            onShowInput={setShowInput}
            onBackToLogs={handleBackToLogs}
            onToggleExpanded={toggleExpanded}
            onExpand={expandToLastHeight}
            onExportConsole={exportConsole}
            onClearConsole={clearCurrentWorkflowConsole}
            onResizeStart={startOutputResize}
          />
        )}
      </div>
      <PointActionMenu
        label='Log actions'
        point={rowMenu}
        onClose={() => setRowMenu(null)}
        actions={rowMenuActions}
      />
    </aside>
  )
}
