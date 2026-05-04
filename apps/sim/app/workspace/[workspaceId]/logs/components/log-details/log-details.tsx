'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatDuration } from '@sim/utils/formatting'
import { ArrowDown, ArrowUp, Check, ChevronUp, Clipboard, Eye, Search, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  Button,
  Code,
  Copy as CopyIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Redo,
  Search as SearchIcon,
  SModalTabs,
  SModalTabsContent,
  SModalTabsList,
  SModalTabsTrigger,
  Tooltip,
} from '@/components/emcn'
import type { WorkflowLogRow } from '@/lib/api/contracts/logs'
import { BASE_EXECUTION_CHARGE } from '@/lib/billing/constants'
import { cn } from '@/lib/core/utils/cn'
import { filterHiddenOutputKeys } from '@/lib/logs/execution/trace-spans/trace-spans'
import type { TraceSpan } from '@/lib/logs/types'
import { workflowBorderColor } from '@/lib/workspaces/colors'
import {
  ExecutionSnapshot,
  FileCards,
  TraceView,
} from '@/app/workspace/[workspaceId]/logs/components'
import { useLogDetailsResize } from '@/app/workspace/[workspaceId]/logs/hooks'
import {
  DELETED_WORKFLOW_COLOR,
  DELETED_WORKFLOW_LABEL,
  formatDate,
  getDisplayStatus,
  StatusBadge,
  TriggerBadge,
} from '@/app/workspace/[workspaceId]/logs/utils'
import { useCodeViewerFeatures } from '@/hooks/use-code-viewer'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { formatCost } from '@/providers/utils'
import { useLogDetailsUIStore } from '@/stores/logs/store'
import { MAX_LOG_DETAILS_WIDTH_RATIO, MIN_LOG_DETAILS_WIDTH } from '@/stores/logs/utils'

export const WorkflowOutputSection = memo(
  function WorkflowOutputSection({ output }: { output: Record<string, unknown> }) {
    const contentRef = useRef<HTMLDivElement>(null)
    const [copied, setCopied] = useState(false)
    const copyTimerRef = useRef<number | null>(null)

    const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })

    const {
      isSearchActive,
      searchQuery,
      setSearchQuery,
      matchCount,
      currentMatchIndex,
      activateSearch,
      closeSearch,
      goToNextMatch,
      goToPreviousMatch,
      handleMatchCountChange,
      searchInputRef,
    } = useCodeViewerFeatures({ contentRef })

    const jsonString = useMemo(() => JSON.stringify(output, null, 2), [output])

    function handleContextMenu(e: React.MouseEvent) {
      e.preventDefault()
      e.stopPropagation()
      setContextMenuPosition({ x: e.clientX, y: e.clientY })
      setIsContextMenuOpen(true)
    }

    function handleCopy() {
      navigator.clipboard.writeText(jsonString)
      setCopied(true)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500)
      setIsContextMenuOpen(false)
    }

    useEffect(() => {
      return () => {
        if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      }
    }, [])

    function handleSearch() {
      activateSearch()
      setIsContextMenuOpen(false)
    }

    return (
      <div className='relative flex min-w-0 flex-col overflow-hidden'>
        <div ref={contentRef} onContextMenu={handleContextMenu} className='relative'>
          <Code.Viewer
            code={jsonString}
            language='json'
            className='!bg-[var(--surface-4)] dark:!bg-[var(--surface-3)] max-h-[300px] min-h-0 max-w-full rounded-md border-0 [word-break:break-all]'
            wrapText
            searchQuery={isSearchActive ? searchQuery : undefined}
            currentMatchIndex={currentMatchIndex}
            onMatchCountChange={handleMatchCountChange}
          />
          {/* Glass action buttons overlay */}
          {!isSearchActive && (
            <div className='absolute top-[7px] right-[6px] z-10 flex gap-1'>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    type='button'
                    variant='default'
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCopy()
                    }}
                    className='h-[20px] w-[20px] cursor-pointer border border-[var(--border-1)] bg-transparent p-0 backdrop-blur-sm hover-hover:bg-[var(--surface-3)]'
                  >
                    {copied ? (
                      <Check className='h-[10px] w-[10px] text-[var(--text-success)]' />
                    ) : (
                      <Clipboard className='h-[10px] w-[10px]' />
                    )}
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>{copied ? 'Copied' : 'Copy'}</Tooltip.Content>
              </Tooltip.Root>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    type='button'
                    variant='default'
                    onClick={(e) => {
                      e.stopPropagation()
                      activateSearch()
                    }}
                    className='h-[20px] w-[20px] cursor-pointer border border-[var(--border-1)] bg-transparent p-0 backdrop-blur-sm hover-hover:bg-[var(--surface-3)]'
                  >
                    <Search className='h-[10px] w-[10px]' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>Search</Tooltip.Content>
              </Tooltip.Root>
            </div>
          )}
        </div>

        {/* Search Overlay */}
        {isSearchActive && (
          <div
            className='absolute top-0 right-0 z-30 flex h-[34px] items-center gap-1.5 rounded-sm border border-[var(--border)] bg-[var(--surface-1)] px-1.5 shadow-sm'
            onClick={(e) => e.stopPropagation()}
          >
            <Input
              ref={searchInputRef}
              type='text'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder='Search...'
              className='mr-0.5 h-[23px] w-[94px] text-caption'
            />
            <span
              className={cn(
                'min-w-[45px] text-center text-xs',
                matchCount > 0 ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]'
              )}
            >
              {matchCount > 0 ? `${currentMatchIndex + 1}/${matchCount}` : '0/0'}
            </span>
            <Button
              variant='ghost'
              className='!p-1'
              onClick={goToPreviousMatch}
              disabled={matchCount === 0}
              aria-label='Previous match'
            >
              <ArrowUp className='h-[12px] w-[12px]' />
            </Button>
            <Button
              variant='ghost'
              className='!p-1'
              onClick={goToNextMatch}
              disabled={matchCount === 0}
              aria-label='Next match'
            >
              <ArrowDown className='h-[12px] w-[12px]' />
            </Button>
            <Button
              variant='ghost'
              className='!p-1'
              onClick={closeSearch}
              aria-label='Close search'
            >
              <X className='h-[12px] w-[12px]' />
            </Button>
          </div>
        )}

        {/* Context Menu - rendered in portal to avoid transform/overflow clipping */}
        {typeof document !== 'undefined' &&
          createPortal(
            <DropdownMenu
              open={isContextMenuOpen}
              onOpenChange={() => setIsContextMenuOpen(false)}
              modal={false}
            >
              <DropdownMenuTrigger asChild>
                <div
                  style={{
                    position: 'fixed',
                    left: `${contextMenuPosition.x}px`,
                    top: `${contextMenuPosition.y}px`,
                    width: '1px',
                    height: '1px',
                    pointerEvents: 'none',
                  }}
                  tabIndex={-1}
                  aria-hidden
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='start'
                side='bottom'
                sideOffset={4}
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                <DropdownMenuItem onSelect={handleCopy}>
                  <CopyIcon />
                  Copy
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleSearch}>
                  <SearchIcon />
                  Search
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>,
            document.body
          )}
      </div>
    )
  },
  (prev, next) => prev.output === next.output
)

export type LogDetailsTab = 'overview' | 'trace'

interface LogDetailsContentProps {
  log: WorkflowLogRow
  onActiveTabChange?: (tab: LogDetailsTab) => void
}

export function LogDetailsContent({ log, onActiveTabChange }: LogDetailsContentProps) {
  const [isExecutionSnapshotOpen, setIsExecutionSnapshotOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<LogDetailsTab>('overview')
  const [prevLogId, setPrevLogId] = useState(log.id)
  const [copiedRunId, setCopiedRunId] = useState(false)

  if (prevLogId !== log.id) {
    setPrevLogId(log.id)
    setActiveTab('overview')
  }

  const copiedRunIdTimerRef = useRef<number | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return () => {
      if (copiedRunIdTimerRef.current !== null) window.clearTimeout(copiedRunIdTimerRef.current)
    }
  }, [])

  const { config: permissionConfig } = usePermissionConfig()

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = 0
    }
  }, [log.id])

  const isLikelyExecution = !!log.executionId && log.trigger !== 'mothership'
  const isWorkflowExecutionLog =
    (log.trigger === 'manual' && !!log.duration) || !!log.executionData?.traceSpans

  const hasCostInfo = !!(isWorkflowExecutionLog && log.cost)
  const showWorkflowState =
    isWorkflowExecutionLog &&
    !!log.executionId &&
    log.trigger !== 'mothership' &&
    !permissionConfig.hideTraceSpans

  const showTraceTab = !permissionConfig.hideTraceSpans && isLikelyExecution
  // double-cast-allowed: contract schema makes duration/startTime optional for legacy persisted JSON; runtime data always supplies them.
  const traceSpans = log.executionData?.traceSpans as unknown as TraceSpan[] | undefined

  const resolvedTab: LogDetailsTab = activeTab === 'trace' && !showTraceTab ? 'overview' : activeTab

  useLayoutEffect(() => {
    onActiveTabChange?.(resolvedTab)
  }, [resolvedTab, onActiveTabChange])

  const workflowOutput = useMemo(() => {
    const executionData = log.executionData as { finalOutput?: Record<string, unknown> } | undefined
    if (!executionData?.finalOutput) return null
    return filterHiddenOutputKeys(executionData.finalOutput) as Record<string, unknown>
  }, [log.executionData])

  const workflowInput = useMemo(() => {
    const executionData = log.executionData as { workflowInput?: unknown } | undefined
    const raw = executionData?.workflowInput
    if (raw === undefined || raw === null) return null
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>
    }
    return { input: raw } as Record<string, unknown>
  }, [log.executionData])

  const formattedTimestamp = formatDate(log.createdAt)
  const logStatus = getDisplayStatus(log.status)

  return (
    <>
      <SModalTabs
        value={resolvedTab}
        onValueChange={(v) => {
          const tab = v as LogDetailsTab
          setActiveTab(tab)
          onActiveTabChange?.(tab)
        }}
        className='mt-4 flex min-h-0 flex-1 flex-col'
      >
        <SModalTabsList activeValue={resolvedTab} className='!px-0 border-[var(--border)] border-b'>
          <SModalTabsTrigger value='overview'>Overview</SModalTabsTrigger>
          {showTraceTab && <SModalTabsTrigger value='trace'>Trace</SModalTabsTrigger>}
        </SModalTabsList>

        {/* Overview Tab */}
        <SModalTabsContent
          ref={scrollAreaRef}
          value='overview'
          className='mt-4 min-h-0 flex-1 overflow-y-auto'
        >
          <div className='flex flex-col gap-2.5 pb-4'>
            {/* Timestamp + Workflow header */}
            <div className='grid grid-cols-2 gap-x-3 pb-0.5'>
              <div className='flex min-w-0 flex-col gap-0.5'>
                <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                  Timestamp
                </span>
                <span className='font-medium text-[var(--text-secondary)] text-sm tabular-nums'>
                  {formattedTimestamp
                    ? `${formattedTimestamp.compactDate} ${formattedTimestamp.compactTime}`
                    : '—'}
                </span>
              </div>
              <div className='flex min-w-0 flex-col gap-0.5'>
                <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                  {log.trigger === 'mothership' ? 'Job' : 'Workflow'}
                </span>
                <div className='flex min-w-0 items-center gap-1.5'>
                  {(() => {
                    const c =
                      log.trigger === 'mothership'
                        ? '#ec4899'
                        : log.workflow?.color ||
                          (!log.workflowId ? DELETED_WORKFLOW_COLOR : undefined)
                    return (
                      <div
                        className='h-[8px] w-[8px] flex-shrink-0 rounded-[2px] border-[1.5px]'
                        style={{
                          backgroundColor: c,
                          borderColor: c ? workflowBorderColor(c) : undefined,
                          backgroundClip: 'padding-box',
                        }}
                      />
                    )
                  })()}
                  <span className='min-w-0 truncate font-medium text-[var(--text-secondary)] text-sm'>
                    {log.trigger === 'mothership'
                      ? log.jobTitle || 'Untitled Job'
                      : log.workflow?.name ||
                        (!log.workflowId ? DELETED_WORKFLOW_LABEL : 'Unknown')}
                  </span>
                </div>
              </div>
            </div>

            {/* Details Section */}
            <div className='divide-y divide-[var(--border)] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-2)] dark:bg-transparent'>
              {/* Run ID — click to copy */}
              {log.executionId && (
                <div
                  className='flex h-10 min-w-0 cursor-pointer items-center justify-between gap-4 px-3 transition-colors hover-hover:bg-[var(--surface-2)]'
                  onClick={() => {
                    navigator.clipboard.writeText(log.executionId!)
                    if (copiedRunIdTimerRef.current) clearTimeout(copiedRunIdTimerRef.current)
                    setCopiedRunId(true)
                    copiedRunIdTimerRef.current = window.setTimeout(
                      () => setCopiedRunId(false),
                      1500
                    )
                  }}
                >
                  <span className='flex-shrink-0 font-medium text-[var(--text-tertiary)] text-caption'>
                    Run ID
                  </span>
                  <span className='min-w-0 truncate font-medium text-[var(--text-secondary)] text-caption tabular-nums'>
                    {copiedRunId ? 'Copied!' : log.executionId}
                  </span>
                </div>
              )}

              {/* Level */}
              <div className='flex h-10 items-center justify-between px-3 transition-colors hover-hover:bg-[var(--surface-2)]'>
                <span className='font-medium text-[var(--text-tertiary)] text-caption'>Level</span>
                <StatusBadge status={logStatus} />
              </div>

              {/* Trigger */}
              <div className='flex h-10 items-center justify-between px-3 transition-colors hover-hover:bg-[var(--surface-2)]'>
                <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                  Trigger
                </span>
                {log.trigger ? (
                  <TriggerBadge trigger={log.trigger} />
                ) : (
                  <span className='font-medium text-[var(--text-secondary)] text-caption'>—</span>
                )}
              </div>

              {/* Duration */}
              <div className='flex h-10 items-center justify-between px-3 transition-colors hover-hover:bg-[var(--surface-2)]'>
                <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                  Duration
                </span>
                <span className='font-medium text-[var(--text-secondary)] text-caption tabular-nums'>
                  {formatDuration(log.duration, { precision: 2 }) || '—'}
                </span>
              </div>

              {/* Version */}
              {log.deploymentVersion && (
                <div className='flex h-10 items-center gap-2 px-3 transition-colors hover-hover:bg-[var(--surface-2)]'>
                  <span className='flex-shrink-0 font-medium text-[var(--text-tertiary)] text-caption'>
                    Version
                  </span>
                  <div className='flex w-0 flex-1 justify-end'>
                    <span className='max-w-full truncate rounded-md bg-[var(--badge-success-bg)] px-[9px] py-0.5 font-medium text-[var(--badge-success-text)] text-caption'>
                      {log.deploymentVersionName || `v${log.deploymentVersion}`}
                    </span>
                  </div>
                </div>
              )}

              {/* Snapshot */}
              {showWorkflowState && (
                <div className='flex h-10 items-center justify-between px-3 transition-colors hover-hover:bg-[var(--surface-2)]'>
                  <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                    Snapshot
                  </span>
                  <Button
                    variant='default'
                    size='sm'
                    className='gap-1'
                    onClick={() => setIsExecutionSnapshotOpen(true)}
                  >
                    <Eye className='h-3 w-3' />
                    View Snapshot
                  </Button>
                </div>
              )}
            </div>

            {/* Workflow Input */}
            {isWorkflowExecutionLog && workflowInput && !permissionConfig.hideTraceSpans && (
              <div className='flex flex-col gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 dark:bg-transparent'>
                <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                  Workflow Input
                </span>
                <WorkflowOutputSection output={workflowInput} />
              </div>
            )}

            {/* Workflow Output */}
            {isWorkflowExecutionLog && workflowOutput && !permissionConfig.hideTraceSpans && (
              <div className='flex flex-col gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 dark:bg-transparent'>
                <span
                  className={cn(
                    'font-medium text-caption',
                    workflowOutput.error
                      ? 'text-[var(--text-error)]'
                      : 'text-[var(--text-tertiary)]'
                  )}
                >
                  Workflow Output
                </span>
                <WorkflowOutputSection output={workflowOutput} />
              </div>
            )}

            {/* Files */}
            {log.files && log.files.length > 0 && <FileCards files={log.files} isExecutionFile />}

            {/* Cost Breakdown */}
            {hasCostInfo && (
              <div className='divide-y divide-[var(--border)] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-2)] dark:bg-transparent'>
                <div className='flex h-10 items-center justify-between px-3 transition-colors hover-hover:bg-[var(--surface-2)]'>
                  <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                    Base Run
                  </span>
                  <span className='font-medium text-[var(--text-secondary)] text-caption tabular-nums'>
                    {formatCost(BASE_EXECUTION_CHARGE)}
                  </span>
                </div>
                <div className='flex h-10 items-center justify-between px-3 transition-colors hover-hover:bg-[var(--surface-2)]'>
                  <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                    Model Input
                  </span>
                  <span className='font-medium text-[var(--text-secondary)] text-caption tabular-nums'>
                    {formatCost(log.cost?.input || 0)}
                  </span>
                </div>
                <div className='flex h-10 items-center justify-between px-3 transition-colors hover-hover:bg-[var(--surface-2)]'>
                  <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                    Model Output
                  </span>
                  <span className='font-medium text-[var(--text-secondary)] text-caption tabular-nums'>
                    {formatCost(log.cost?.output || 0)}
                  </span>
                </div>
                {(() => {
                  const models = (log.cost as Record<string, unknown>)?.models as
                    | Record<string, { toolCost?: number }>
                    | undefined
                  const totalToolCost = models
                    ? Object.values(models).reduce((sum, m) => sum + (m?.toolCost || 0), 0)
                    : 0
                  return totalToolCost > 0 ? (
                    <div className='flex h-10 items-center justify-between px-3 transition-colors hover-hover:bg-[var(--surface-2)]'>
                      <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                        Tool Usage
                      </span>
                      <span className='font-medium text-[var(--text-secondary)] text-caption tabular-nums'>
                        {formatCost(totalToolCost)}
                      </span>
                    </div>
                  ) : null
                })()}
                <div className='flex h-10 items-center justify-between px-3 transition-colors hover-hover:bg-[var(--surface-2)]'>
                  <span className='font-medium text-[var(--text-secondary)] text-caption'>
                    Total
                  </span>
                  <span className='font-semibold text-[var(--text-primary)] text-caption tabular-nums'>
                    {formatCost(log.cost?.total || 0)}
                  </span>
                </div>
                <div className='flex h-10 items-center justify-between px-3 transition-colors hover-hover:bg-[var(--surface-2)]'>
                  <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                    Tokens
                  </span>
                  <span className='font-medium text-[var(--text-secondary)] text-caption tabular-nums'>
                    {log.cost?.tokens?.input || log.cost?.tokens?.prompt || 0} in ·{' '}
                    {log.cost?.tokens?.output || log.cost?.tokens?.completion || 0} out
                  </span>
                </div>
                <div className='px-3 py-2'>
                  <p className='font-medium text-[var(--text-tertiary)] text-xs'>
                    Total includes a {formatCost(BASE_EXECUTION_CHARGE)} base charge plus model and
                    tool usage.
                  </p>
                </div>
              </div>
            )}
          </div>
        </SModalTabsContent>

        {/* Trace Tab */}
        {showTraceTab && (
          <SModalTabsContent
            value='trace'
            className='mt-3 min-h-0 flex-1 overflow-hidden focus-visible:outline-none'
          >
            {traceSpans?.length ? (
              <TraceView traceSpans={traceSpans} />
            ) : log.executionData ? (
              <div className='flex h-full items-center justify-center px-4 text-center'>
                <span className='font-medium text-[var(--text-tertiary)] text-sm'>
                  No trace data available for this run
                </span>
              </div>
            ) : (
              <div className='flex h-full items-center justify-center px-4 text-center'>
                <span className='font-medium text-[var(--text-tertiary)] text-sm'>
                  Loading trace…
                </span>
              </div>
            )}
          </SModalTabsContent>
        )}
      </SModalTabs>

      {/* Frozen Canvas Modal */}
      {log.executionId && (
        <ExecutionSnapshot
          executionId={log.executionId}
          traceSpans={traceSpans}
          isModal
          isOpen={isExecutionSnapshotOpen}
          onClose={() => setIsExecutionSnapshotOpen(false)}
        />
      )}
    </>
  )
}

interface LogDetailsProps {
  log: WorkflowLogRow | null
  isOpen: boolean
  onClose: () => void
  onNavigateNext?: () => void
  onNavigatePrev?: () => void
  hasNext?: boolean
  hasPrev?: boolean
  onRetryExecution?: () => void
  isRetryPending?: boolean
  onActiveTabChange?: (tab: LogDetailsTab) => void
}

export const LogDetails = memo(function LogDetails({
  log,
  isOpen,
  onClose,
  onNavigateNext,
  onNavigatePrev,
  hasNext = false,
  hasPrev = false,
  onRetryExecution,
  isRetryPending = false,
  onActiveTabChange,
}: LogDetailsProps) {
  const activeTabRef = useRef<LogDetailsTab>('overview')

  const handleActiveTabChange = useCallback(
    (tab: LogDetailsTab) => {
      activeTabRef.current = tab
      onActiveTabChange?.(tab)
    },
    [onActiveTabChange]
  )

  const panelWidth = useLogDetailsUIStore((state) => state.panelWidth)
  const { handleMouseDown } = useLogDetailsResize()

  const maxVw = `${MAX_LOG_DETAILS_WIDTH_RATIO * 100}vw`
  const effectiveWidth = `clamp(min(${MIN_LOG_DETAILS_WIDTH}px, ${maxVw}), ${panelWidth}px, ${maxVw})`

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }

      if (!isOpen) return

      // Trace tab owns arrow keys for span navigation.
      if (activeTabRef.current === 'trace') return

      if (e.key === 'ArrowUp' && hasPrev && onNavigatePrev) {
        e.preventDefault()
        onNavigatePrev()
      }

      if (e.key === 'ArrowDown' && hasNext && onNavigateNext) {
        e.preventDefault()
        onNavigateNext()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, hasPrev, hasNext, onNavigatePrev, onNavigateNext])

  return (
    <>
      {/* Resize Handle - positioned outside the panel */}
      {isOpen && (
        <div
          className='absolute top-0 bottom-0 z-[var(--z-dropdown)] w-[8px] cursor-ew-resize'
          style={{ right: `calc(${effectiveWidth} - 4px)` }}
          onMouseDown={handleMouseDown}
          role='separator'
          aria-label='Resize log details panel'
          aria-orientation='vertical'
        />
      )}

      <div
        className={cn(
          'absolute top-0 right-0 bottom-0 z-[var(--z-dropdown)] overflow-hidden border-l bg-[var(--bg)] shadow-md transition-transform duration-200 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
        style={{ width: effectiveWidth }}
        aria-label='Log details sidebar'
      >
        {log && (
          <div className='flex h-full flex-col px-3.5 pt-3'>
            {/* Header */}
            <div className='flex items-center justify-between'>
              <h2 className='font-medium text-[var(--text-primary)] text-sm'>Log Details</h2>
              <div className='flex items-center gap-[1px]'>
                {log.status === 'failed' &&
                  (log.workflow?.id || log.workflowId) &&
                  log.trigger !== 'mothership' && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          className='!p-1'
                          onClick={() => onRetryExecution?.()}
                          disabled={isRetryPending}
                          aria-label='Retry execution'
                        >
                          <Redo className='h-[14px] w-[14px]' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content side='bottom'>Retry</Tooltip.Content>
                    </Tooltip.Root>
                  )}
                <Button
                  variant='ghost'
                  className='!p-1'
                  onClick={() => hasPrev && onNavigatePrev?.()}
                  disabled={!hasPrev}
                  aria-label='Previous log'
                >
                  <ChevronUp className='h-[14px] w-[14px]' />
                </Button>
                <Button
                  variant='ghost'
                  className='!p-1'
                  onClick={() => hasNext && onNavigateNext?.()}
                  disabled={!hasNext}
                  aria-label='Next log'
                >
                  <ChevronUp className='h-[14px] w-[14px] rotate-180' />
                </Button>
                <Button variant='ghost' className='!p-1' onClick={onClose} aria-label='Close'>
                  <X className='h-[14px] w-[14px]' />
                </Button>
              </div>
            </div>

            <LogDetailsContent log={log} onActiveTabChange={handleActiveTabChange} />
          </div>
        )}
      </div>
    </>
  )
})
