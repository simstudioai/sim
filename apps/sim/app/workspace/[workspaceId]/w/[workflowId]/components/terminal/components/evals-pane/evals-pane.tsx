'use client'

import {
  type MouseEvent,
  memo,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  Button,
  ChevronDown,
  cn,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  Square,
  Tooltip,
} from '@sim/emcn'
import { PlayOutline } from '@sim/emcn/icons'
import { EvalStatusIndicator, type EvalStatusIndicatorStatus, ShimmerText } from '@/components/ui'
import type { WorkflowEvalSuite, WorkflowEvalTestRun } from '@/lib/api/contracts/workflow-evals'
import {
  type EvalTestSelection,
  type EvalTestSelectionKey,
  getEvalTestRunDescription,
  getEvalTestSelectionKey,
  resolveEvalTestSelection,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components/evals-pane/eval-test-selection'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'

interface EvalStatusItemBase {
  testId: string
  testName: string
  label: string
  isPassed: boolean
  description?: string
  errorBlockIds?: readonly string[]
  runId?: string
  testRun?: WorkflowEvalTestRun
}

type EvalStatusItem = EvalStatusItemBase & { status: EvalStatusIndicatorStatus }

const EVAL_STATUS_DOT_SIZE_PX = 18
const EVAL_SUITE_ROW_HORIZONTAL_PADDING_PX = 16

interface EvalTestContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: RefObject<HTMLDivElement | null>
  selection: EvalTestSelection | null
  retryDisabled: boolean
  onClose: () => void
  onRetry: (selection: EvalTestSelection) => void
  onDetails: (selection: EvalTestSelection) => void
}

function EvalTestContextMenu({
  isOpen,
  position,
  menuRef,
  selection,
  retryDisabled,
  onClose,
  onRetry,
  onDetails,
}: EvalTestContextMenuProps) {
  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      variant='secondary'
      size='sm'
      colorScheme='inverted'
    >
      <PopoverAnchor
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: '1px',
          height: '1px',
        }}
      />
      <PopoverContent ref={menuRef} align='start' side='bottom' sideOffset={4}>
        <PopoverItem
          disabled={retryDisabled}
          onClick={() => {
            if (!selection) throw new Error('Eval test context menu is missing its selection')
            onRetry(selection)
            onClose()
          }}
        >
          Retry
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            if (!selection) throw new Error('Eval test context menu is missing its selection')
            onDetails(selection)
            onClose()
          }}
        >
          Details
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
}

function getEvalStatusColumnCount(listWidth: number): number {
  const availableWidth = listWidth - EVAL_SUITE_ROW_HORIZONTAL_PADDING_PX
  if (availableWidth <= 0) return 0
  return Math.max(1, Math.floor(availableWidth / EVAL_STATUS_DOT_SIZE_PX))
}

function getEvalStatusFillerCount(itemCount: number, columnCount: number): number {
  if (columnCount === 0) return 0
  if (itemCount === 0) return columnCount
  const remainder = itemCount % columnCount
  return remainder === 0 ? 0 : columnCount - remainder
}

function getSettledStatus(
  testRun: WorkflowEvalTestRun
): Extract<
  EvalStatusIndicatorStatus,
  'complete' | 'failed' | 'partial-success' | 'partial-failure'
> {
  if (testRun.phase === 'error') {
    return testRun.evaluatorType === 'agent' ? 'partial-failure' : 'failed'
  }
  if (testRun.phase !== 'completed' || testRun.outcome === null) {
    throw new Error(`Eval test run ${testRun.id} is not settled`)
  }
  if (testRun.outcome === 'warning') return 'partial-success'
  return testRun.outcome === 'pass' ? 'complete' : 'failed'
}

function getSettledLabel(testRun: WorkflowEvalTestRun): string {
  const verdict =
    testRun.phase === 'error'
      ? 'Error'
      : testRun.outcome === 'pass'
        ? 'Passed'
        : testRun.outcome === 'warning'
          ? 'Warning'
          : 'Failed'
  return testRun.evaluatorType === 'agent'
    ? `${testRun.name}: ${verdict} by LLM judge`
    : `${testRun.name}: ${verdict}`
}

function getEvalStatusItems(suite: WorkflowEvalSuite, resetForNewRun = false): EvalStatusItem[] {
  if (suite.tests.length !== suite.testCount) {
    throw new Error(
      `Eval suite ${suite.id} has testCount ${suite.testCount}, but ${suite.tests.length} test summaries`
    )
  }

  const latestRun = suite.latestRun
  if (resetForNewRun) {
    return suite.tests.map((test, ordinal) => ({
      testId: test.id,
      testName: test.name,
      label: `${test.name}: ${ordinal === 0 ? 'Starting' : 'Not started'}`,
      isPassed: false,
      status: ordinal === 0 ? 'progress' : 'pending',
    }))
  }
  if (!latestRun) {
    return suite.tests.map((test) => ({
      testId: test.id,
      testName: test.name,
      label: `${test.name}: Not started`,
      isPassed: false,
      status: 'pending',
    }))
  }
  const isTestOverlay = latestRun.scope === 'test'
  const baselineRun = isTestOverlay ? suite.latestSuiteRun : latestRun
  const tests = isTestOverlay ? suite.tests : latestRun.tests
  if (!isTestOverlay && tests.length !== latestRun.totalCount) {
    throw new Error(
      `Eval run ${latestRun.id} has totalCount ${latestRun.totalCount}, but ${tests.length} test summaries`
    )
  }

  const testIds = new Set<string>()
  for (const test of tests) {
    if (testIds.has(test.id)) {
      throw new Error(`Eval run for suite ${suite.id} contains duplicate test ${test.id}`)
    }
    testIds.add(test.id)
  }

  const testRunsByTestId = new Map<string, { runId: string; testRun: WorkflowEvalTestRun }>()
  if (baselineRun) {
    for (const testRun of baselineRun.testRuns) {
      if (!testIds.has(testRun.testId)) continue
      if (testRunsByTestId.has(testRun.testId)) {
        throw new Error(
          `Eval run ${baselineRun.id} contains multiple rows for test ${testRun.testId}`
        )
      }
      testRunsByTestId.set(testRun.testId, { runId: baselineRun.id, testRun })
    }
  }
  if (isTestOverlay) {
    if (latestRun.testRuns.length !== 1 || latestRun.selectedTestId === null) {
      throw new Error(`Test-scoped Eval run ${latestRun.id} must contain exactly one selected test`)
    }
    const overlay = latestRun.testRuns[0]
    if (overlay.testId !== latestRun.selectedTestId || !testIds.has(overlay.testId)) {
      throw new Error(`Test-scoped Eval run ${latestRun.id} selected an unknown test`)
    }
    testRunsByTestId.set(overlay.testId, { runId: latestRun.id, testRun: overlay })
  }

  return tests.map((test) => {
    const runTest = testRunsByTestId.get(test.id)
    if (!runTest) {
      return {
        testId: test.id,
        testName: test.name,
        label: `${test.name}: Not started`,
        isPassed: false,
        status: 'pending',
      }
    }
    const { runId, testRun } = runTest

    if (testRun.name !== test.name) {
      throw new Error(`Eval test run ${testRun.id} name does not match test ${test.id}`)
    }
    if (testRun.evaluatorType !== test.evaluatorType) {
      throw new Error(`Eval test run ${testRun.id} evaluator does not match test ${test.id}`)
    }

    const runStatus = latestRun.status
    const isCancelled = runStatus === 'cancelled'
    const isTerminal = runStatus === 'completed' || runStatus === 'error' || isCancelled
    if (testRun.phase === 'queued') {
      return {
        testId: test.id,
        testName: test.name,
        label: `${test.name}: ${isCancelled ? 'Cancelled' : 'Not started'}`,
        isPassed: false,
        status: 'pending',
      }
    }
    if (testRun.phase === 'running_subject' || testRun.phase === 'running_evaluator') {
      if (isCancelled) {
        return {
          testId: test.id,
          testName: test.name,
          label: `${test.name}: Cancelled`,
          isPassed: false,
          status: 'pending',
        }
      }
      if (runStatus === 'error') {
        return {
          testId: test.id,
          testName: test.name,
          label: `${test.name}: Error`,
          isPassed: false,
          description: testRun.error?.message ?? latestRun.error?.message,
          errorBlockIds: testRun.errorBlockIds,
          runId,
          testRun,
          status: testRun.evaluatorType === 'agent' ? 'partial-failure' : 'failed',
        }
      }
      if (isTerminal) {
        return {
          testId: test.id,
          testName: test.name,
          label: `${test.name}: Result unavailable`,
          isPassed: false,
          status: 'pending',
        }
      }
      return {
        testId: test.id,
        testName: test.name,
        label: `${test.name}: Running`,
        isPassed: false,
        status: 'progress',
      }
    }

    const status = getSettledStatus(testRun)
    return {
      testId: test.id,
      testName: test.name,
      label: getSettledLabel(testRun),
      isPassed: testRun.phase === 'completed' && testRun.outcome === 'pass',
      description: getEvalTestRunDescription(testRun),
      errorBlockIds: testRun.errorBlockIds,
      runId,
      testRun,
      status,
    }
  })
}

interface EvalSuiteRowProps {
  suite: WorkflowEvalSuite
  isStarting: boolean
  isStopping: boolean
  statusColumnCount: number
  selectedTest: EvalTestSelection | null
  onRun: (suiteId: string) => void
  onStop: (suiteId: string, runId: string) => void
  onSelectTest: (selection: EvalTestSelection) => void
  onTestContextMenu: (event: MouseEvent<HTMLButtonElement>, selection: EvalTestSelection) => void
}

const EvalSuiteRow = memo(function EvalSuiteRow({
  suite,
  isStarting,
  isStopping,
  statusColumnCount,
  selectedTest,
  onRun,
  onStop,
  onSelectTest,
  onTestContextMenu,
}: EvalSuiteRowProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const run = suite.latestRun
  const hasActiveRun = run?.status === 'queued' || run?.status === 'running'
  const isRunning = isStarting || hasActiveRun
  const showStopControl = isStarting || hasActiveRun
  const statusItems = getEvalStatusItems(suite, isStarting)
  const passedStatusCount = statusItems.reduce((count, item) => count + (item.isPassed ? 1 : 0), 0)
  const fillerCount = getEvalStatusFillerCount(statusItems.length, statusColumnCount)
  const trailingSlotOffset = statusColumnCount === 0 ? 0 : statusItems.length % statusColumnCount
  const statusGridId = `eval-suite-${suite.id}-statuses`

  return (
    <div
      className='group flex min-w-0 flex-col gap-1 rounded-lg px-2 py-1.5 [--eval-status-mask:var(--bg)] hover:bg-[var(--surface-hover)] hover:[--eval-status-mask:var(--surface-hover)]'
      data-eval-suite-row={suite.id}
    >
      <div className='flex h-[22px] min-w-0 items-center gap-2'>
        <div
          className='flex min-w-0 flex-1 items-center gap-0.5'
          data-eval-suite-controls={suite.id}
        >
          <Button
            type='button'
            variant='ghost-secondary'
            size='sm'
            aria-label={showStopControl ? `Stop ${suite.name}` : `Run ${suite.name}`}
            title={showStopControl ? `Stop ${suite.name}` : `Run ${suite.name}`}
            className='!p-0 size-[18px] flex-shrink-0'
            disabled={isStarting || isStopping}
            onClick={() => {
              if (hasActiveRun) {
                onStop(suite.id, run.id)
                return
              }
              onRun(suite.id)
            }}
          >
            {showStopControl ? (
              <Square className='size-[11px]' />
            ) : (
              <PlayOutline className='size-[12px]' />
            )}
          </Button>
          <button
            type='button'
            aria-expanded={!isCollapsed}
            aria-controls={statusGridId}
            className='min-w-0 cursor-pointer truncate text-left text-[var(--text-primary)] text-sm'
            data-eval-suite-name-running={isRunning ? 'true' : undefined}
            data-eval-suite-title={suite.id}
            onClick={() => setIsCollapsed((collapsed) => !collapsed)}
          >
            {isRunning ? (
              <ShimmerText className='[--shimmer-rest:var(--text-primary)]'>
                {suite.name}
              </ShimmerText>
            ) : (
              suite.name
            )}
          </button>
          <button
            type='button'
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${suite.name}`}
            aria-expanded={!isCollapsed}
            aria-controls={statusGridId}
            title={`${isCollapsed ? 'Expand' : 'Collapse'} ${suite.name}`}
            className='flex size-[18px] flex-shrink-0 cursor-pointer items-center justify-center opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100'
            onClick={() => setIsCollapsed((collapsed) => !collapsed)}
          >
            <ChevronDown
              className={cn(
                'h-[7px] w-[9px] text-[var(--text-icon)] transition-transform duration-150 motion-reduce:transition-none',
                isCollapsed && '-rotate-90'
              )}
            />
          </button>
        </div>
        <span
          className='ml-auto flex-shrink-0 text-sm'
          aria-live={isRunning ? 'polite' : undefined}
          data-eval-suite-summary={suite.id}
        >
          {run?.status === 'error' ? (
            <span className='text-[var(--text-secondary)]'>Run failed</span>
          ) : run?.status === 'cancelled' ? (
            <span className='text-[var(--text-secondary)]'>Cancelled</span>
          ) : run ? (
            <span className='text-[var(--text-secondary)] tabular-nums'>
              {passedStatusCount}/{statusItems.length}
            </span>
          ) : (
            <span className='text-[var(--text-secondary)]'>Not run</span>
          )}
        </span>
      </div>

      {!isCollapsed && (
        <div
          id={statusGridId}
          role='group'
          aria-label={`${suite.name} test statuses`}
          className='relative isolate flex min-h-[18px] w-full flex-wrap items-center gap-0'
        >
          {statusItems.map((item) => {
            const selection =
              item.runId && item.testRun
                ? {
                    suiteId: suite.id,
                    runId: item.runId,
                    testRun: item.testRun,
                    description: item.description ?? item.label,
                  }
                : null
            const isSelected =
              selection !== null &&
              selectedTest?.suiteId === selection.suiteId &&
              selectedTest.runId === selection.runId &&
              selectedTest.testRun.testId === selection.testRun.testId
            const indicator = (
              <EvalStatusIndicator
                status={item.status}
                label={item.label}
                selected={isSelected}
                selectionTone={
                  item.status === 'failed' ||
                  item.status === 'partial-failure' ||
                  item.testRun?.outcome === 'fail'
                    ? 'failure'
                    : 'ink'
                }
                className={cn(
                  'transition-transform duration-150 ease-out motion-reduce:transition-none',
                  isSelected
                    ? '-translate-y-px scale-[1.2]'
                    : 'group-hover/dot:-translate-y-px group-hover/dot:scale-[1.2]'
                )}
              />
            )

            return (
              <Tooltip.Root key={item.testId}>
                <Tooltip.Trigger asChild>
                  {selection ? (
                    <button
                      type='button'
                      aria-label={`Show ${item.label}`}
                      aria-pressed={isSelected}
                      data-test-id={item.testId}
                      data-error-block-ids={
                        item.errorBlockIds && item.errorBlockIds.length > 0
                          ? item.errorBlockIds.join(',')
                          : undefined
                      }
                      className={cn(
                        'group/dot relative z-[1] flex size-[18px] cursor-pointer rounded-full bg-[var(--eval-status-mask)] outline-none hover:z-10 focus-visible:z-10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--text-primary)]',
                        isSelected && 'z-10'
                      )}
                      onClick={() => onSelectTest(selection)}
                      onContextMenu={(event) => onTestContextMenu(event, selection)}
                    >
                      {indicator}
                    </button>
                  ) : (
                    <span
                      data-test-id={item.testId}
                      className='group/dot relative z-[1] flex size-[18px] bg-[var(--eval-status-mask)] hover:z-10'
                    >
                      {indicator}
                    </span>
                  )}
                </Tooltip.Trigger>
                <Tooltip.Content offset={8}>{item.testName}</Tooltip.Content>
              </Tooltip.Root>
            )
          })}
          <div
            aria-hidden='true'
            data-eval-status-filler-viewport
            className='pointer-events-none absolute inset-0 z-0 overflow-hidden'
          >
            <div className='absolute bottom-0 left-0 flex' data-eval-status-filler-rail>
              {Array.from({ length: trailingSlotOffset }, (_, index) => (
                <span
                  key={`spacer-${index}`}
                  data-eval-status-filler-spacer
                  className='size-[18px] flex-none'
                />
              ))}
              {Array.from({ length: fillerCount }, (_, index) => (
                <span
                  key={`filler-${index}`}
                  data-eval-status-filler
                  className='flex size-[18px] flex-none'
                >
                  <EvalStatusIndicator status='pending' decorative />
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

interface EvalSuiteListProps {
  suites: readonly WorkflowEvalSuite[]
  startingSuiteId: string | null
  stoppingRunId: string | null
  selectedTest: EvalTestSelection | null
  onRunSuite: (suiteId: string) => void
  onStopRun: (suiteId: string, runId: string) => void
  onSelectTest: (selection: EvalTestSelection) => void
  onTestContextMenu: (event: MouseEvent<HTMLButtonElement>, selection: EvalTestSelection) => void
}

const EvalSuiteList = memo(function EvalSuiteList({
  suites,
  startingSuiteId,
  stoppingRunId,
  selectedTest,
  onRunSuite,
  onStopRun,
  onSelectTest,
  onTestContextMenu,
}: EvalSuiteListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const [statusColumnCount, setStatusColumnCount] = useState(0)

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) throw new Error('Eval suite list did not mount')

    const updateColumnCount = (width: number) => {
      const nextColumnCount = getEvalStatusColumnCount(width)
      setStatusColumnCount((current) => (current === nextColumnCount ? current : nextColumnCount))
    }

    updateColumnCount(list.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) throw new Error('Eval suite list resize event is missing its entry')
      updateColumnCount(entry.contentRect.width)
    })
    observer.observe(list)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={listRef} className='ml-[4px] flex min-w-0 flex-col gap-0.5'>
      {suites.map((suite) => (
        <EvalSuiteRow
          key={suite.id}
          suite={suite}
          isStarting={startingSuiteId === suite.id}
          isStopping={stoppingRunId === suite.latestRun?.id}
          statusColumnCount={statusColumnCount}
          selectedTest={selectedTest}
          onRun={onRunSuite}
          onStop={onStopRun}
          onSelectTest={onSelectTest}
          onTestContextMenu={onTestContextMenu}
        />
      ))}
    </div>
  )
})

export interface TerminalEvalsPaneProps {
  suites: readonly WorkflowEvalSuite[]
  isLoading: boolean
  error: Error | null
  startingSuiteId: string | null
  stoppingRunId: string | null
  selectedTest: EvalTestSelection | null
  isRetryingTest: boolean
  onRunSuite: (suiteId: string) => void
  onStopRun: (suiteId: string, runId: string) => void
  onRetryTest: (suiteId: string, testId: string, expectedDefinitionRevision: number) => void
  onShowDetails: (selection: EvalTestSelection) => void
  onSelectionChange: (selection: EvalTestSelection | null) => void
  onFocusErrorBlocks: (blockIds: readonly string[]) => void
}

export const TerminalEvalsPane = memo(function TerminalEvalsPane({
  suites,
  isLoading,
  error,
  startingSuiteId,
  stoppingRunId,
  selectedTest,
  isRetryingTest,
  onRunSuite,
  onStopRun,
  onRetryTest,
  onShowDetails,
  onSelectionChange,
  onFocusErrorBlocks,
}: TerminalEvalsPaneProps) {
  const [contextSelectionKey, setContextSelectionKey] = useState<EvalTestSelectionKey | null>(null)
  const {
    isOpen: isContextMenuOpen,
    position: contextMenuPosition,
    menuRef: contextMenuRef,
    handleContextMenu,
    closeMenu,
  } = useContextMenu()

  const contextSelection = resolveEvalTestSelection(suites, contextSelectionKey)

  const handleTestContextMenu = useCallback(
    (event: MouseEvent<HTMLButtonElement>, selection: EvalTestSelection) => {
      setContextSelectionKey(getEvalTestSelectionKey(selection))
      handleContextMenu(event)
    },
    [handleContextMenu]
  )

  const handleCloseContextMenu = () => {
    closeMenu()
    setContextSelectionKey(null)
  }

  const contextSuite = contextSelection
    ? suites.find((suite) => suite.id === contextSelection.suiteId)
    : undefined
  const contextRun = contextSuite?.latestRun
  const retryDisabled =
    !contextSuite ||
    isRetryingTest ||
    startingSuiteId === contextSuite.id ||
    contextRun?.status === 'queued' ||
    contextRun?.status === 'running'

  const handleRetryTest = (selection: EvalTestSelection) => {
    const suite = suites.find((candidate) => candidate.id === selection.suiteId)
    if (!suite) throw new Error(`Eval suite ${selection.suiteId} was not found for retry`)
    onRetryTest(suite.id, selection.testRun.testId, suite.definitionRevision)
  }

  const handleSelectTest = useCallback(
    (selection: EvalTestSelection) => {
      const isAlreadySelected =
        selectedTest?.suiteId === selection.suiteId &&
        selectedTest.runId === selection.runId &&
        selectedTest.testRun.testId === selection.testRun.testId
      if (isAlreadySelected) {
        onSelectionChange(null)
        return
      }

      onSelectionChange(selection)
      const { testRun } = selection
      const didNotPass =
        testRun.phase === 'error' ||
        (testRun.phase === 'completed' && testRun.outcome !== null && testRun.outcome !== 'pass')
      if (didNotPass && testRun.errorBlockIds.length > 0) {
        onFocusErrorBlocks(testRun.errorBlockIds)
      }
    },
    [onFocusErrorBlocks, onSelectionChange, selectedTest]
  )

  if (isLoading) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-placeholder)] text-small'>
        Loading evals…
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-error)] text-small'>
        Failed to load evals
      </div>
    )
  }

  if (suites.length === 0) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-placeholder)] text-small'>
        No evals yet
      </div>
    )
  }

  return (
    <div className='h-full overflow-y-auto px-[6px]'>
      <EvalSuiteList
        suites={suites}
        startingSuiteId={startingSuiteId}
        stoppingRunId={stoppingRunId}
        selectedTest={selectedTest}
        onRunSuite={onRunSuite}
        onStopRun={onStopRun}
        onSelectTest={handleSelectTest}
        onTestContextMenu={handleTestContextMenu}
      />
      <EvalTestContextMenu
        isOpen={isContextMenuOpen}
        position={contextMenuPosition}
        menuRef={contextMenuRef}
        selection={contextSelection}
        retryDisabled={retryDisabled}
        onClose={handleCloseContextMenu}
        onRetry={handleRetryTest}
        onDetails={onShowDetails}
      />
    </div>
  )
})
