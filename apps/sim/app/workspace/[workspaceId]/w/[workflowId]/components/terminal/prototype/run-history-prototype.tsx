'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Chip,
  ChipModalTabs,
  ChipTag,
  Code,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  highlight,
  languages,
  Popover,
  PopoverAnchor,
  PopoverContent,
  toast,
} from '@sim/emcn'
import { Check, ChevronDown, ChevronRight, ChevronUp, CircleX, RefreshCw, X } from '@sim/emcn/icons'
import { WorkflowTypeTag } from '@sim/workflow-renderer'
import {
  useOutputPanelResize,
  useTerminalResize,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/hooks'
import { hasBlockAccent } from '@/blocks/accent'
import { getBlock } from '@/blocks/registry'

type RunStatus = 'success' | 'error'
type RunFilter = 'all' | RunStatus
type TimeRange = 'Last 24h' | 'Last 7 days'
type DetailTab = 'error' | 'input' | 'output'

interface RunStep {
  id: string
  name: string
  blockType: string
  status: RunStatus
  duration: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  error?: string
}

interface RunError {
  title: string
  message: string
  code: string
  hint: string
}

interface HistoryRun {
  id: string
  label: string
  time: string
  trigger: string
  status: RunStatus
  duration: string
  retries: number
  error?: RunError
  steps: RunStep[]
}

interface CreateStepsOptions {
  failed?: boolean
  durationOffset?: number
  errorMessage?: string
}

function createSteps({
  failed = false,
  durationOffset = 0,
  errorMessage = 'Slack returned channel_not_found for “#design-leads”.',
}: CreateStepsOptions = {}): RunStep[] {
  return [
    {
      id: 'trigger',
      name: 'Manual trigger',
      blockType: 'start_trigger',
      status: 'success',
      duration: '0.1s',
      input: { campaign: 'Design leaders', limit: 25 },
      output: { accepted: true },
    },
    {
      id: 'search',
      name: 'Search prospects',
      blockType: 'google_search',
      status: 'success',
      duration: `${(1.1 + durationOffset).toFixed(1)}s`,
      input: { query: 'VP Design OR Head of Design', limit: 25 },
      output: { results: 25, source: 'Google Search' },
    },
    {
      id: 'draft',
      name: 'Draft outreach message',
      blockType: 'agent',
      status: 'success',
      duration: `${(4.6 + durationOffset).toFixed(1)}s`,
      input: { prospect: 'Avery Chen', company: 'Northstar' },
      output: { message: 'Hi Avery — I enjoyed your recent product design talk…' },
    },
    {
      id: 'send',
      name: 'Send Slack message',
      blockType: 'slack',
      status: failed ? 'error' : 'success',
      duration: `${(1.2 + durationOffset).toFixed(1)}s`,
      input: { channel: '#design-leads', message: 'Hi Avery — I enjoyed your recent talk…' },
      output: { sent: !failed, channel: failed ? undefined : '#design-leads' },
      error: failed ? errorMessage : undefined,
    },
  ]
}

const RUN_HISTORY: HistoryRun[] = [
  {
    id: 'run-1842',
    label: 'Run #1842',
    time: 'Today, 10:42 AM',
    trigger: 'Manual',
    status: 'error',
    duration: '8.4s',
    retries: 0,
    error: {
      title: 'channel_not_found',
      message: 'Slack could not find #design-leads.',
      code: 'SlackApiError: channel_not_found\n  at Send Slack message (step 04)\n  channel: #design-leads',
      hint: 'Check that the channel exists and the connection can post to it.',
    },
    steps: createSteps({ failed: true }),
  },
  {
    id: 'run-1841',
    label: 'Run #1841',
    time: 'Today, 9:18 AM',
    trigger: 'Schedule',
    status: 'success',
    duration: '6.9s',
    retries: 0,
    steps: createSteps(),
  },
  {
    id: 'run-1840',
    label: 'Run #1840',
    time: 'Today, 8:03 AM',
    trigger: 'API',
    status: 'success',
    duration: '7.2s',
    retries: 0,
    steps: createSteps({ durationOffset: 0.1 }),
  },
  {
    id: 'run-1839',
    label: 'Run #1839',
    time: 'Yesterday, 5:31 PM',
    trigger: 'Schedule',
    status: 'error',
    duration: '12.8s',
    retries: 1,
    error: {
      title: 'rate_limited',
      message: 'Slack rate-limited the final message.',
      code: 'SlackApiError: rate_limited\n  at Send Slack message (step 04)\n  retry-after: 30s',
      hint: 'Retry the run now or increase the delay before the final step.',
    },
    steps: createSteps({
      failed: true,
      durationOffset: 1.2,
      errorMessage: 'Slack returned rate_limited. Retry after 30 seconds.',
    }),
  },
  {
    id: 'run-1838',
    label: 'Run #1838',
    time: 'Yesterday, 3:14 PM',
    trigger: 'Manual',
    status: 'success',
    duration: '5.8s',
    retries: 0,
    steps: createSteps({ durationOffset: -0.2 }),
  },
  {
    id: 'run-1837',
    label: 'Run #1837',
    time: 'Yesterday, 1:02 PM',
    trigger: 'API',
    status: 'success',
    duration: '6.4s',
    retries: 0,
    steps: createSteps({ durationOffset: -0.1 }),
  },
  {
    id: 'run-1836',
    label: 'Run #1836',
    time: 'Yesterday, 11:47 AM',
    trigger: 'Schedule',
    status: 'success',
    duration: '7.0s',
    retries: 0,
    steps: createSteps(),
  },
  {
    id: 'run-1835',
    label: 'Run #1835',
    time: 'Yesterday, 9:26 AM',
    trigger: 'Manual',
    status: 'success',
    duration: '6.1s',
    retries: 0,
    steps: createSteps({ durationOffset: -0.1 }),
  },
]

const RUN_FILTER_LABELS: Record<RunFilter, string> = {
  all: 'All runs',
  success: 'Completed',
  error: 'Failed',
}

const RUN_TABLE_GRID =
  'grid min-w-[780px] grid-cols-[minmax(150px,1.1fr)_minmax(90px,0.7fr)_72px_88px_minmax(190px,1.6fr)_72px] items-center gap-3 px-4'

function statusLabel(status: RunStatus): string {
  return status === 'error' ? 'Failed' : 'Completed'
}

function defaultTabForStep(step: RunStep): DetailTab {
  return step.error ? 'error' : 'output'
}

interface StepTypeTagProps {
  blockType: string
  showLabel?: boolean
}

function StepTypeTag({ blockType, showLabel = true }: StepTypeTagProps) {
  const config = getBlock(blockType)
  if (!config) return null

  return (
    <WorkflowTypeTag
      type={config.type}
      typeLabel={showLabel ? (config.canvasPresentation?.typeLabel ?? config.name) : undefined}
      Icon={config.icon}
      iconBgColor={config.bgColor}
      isIntegration={!hasBlockAccent(config.type)}
    />
  )
}

interface StepRowProps {
  step: RunStep
  selected: boolean
  onSelect: (step: RunStep) => void
}

function StepRow({ step, selected, onSelect }: StepRowProps) {
  const StatusIcon = step.status === 'error' ? CircleX : Check

  return (
    <button
      type='button'
      className={cn(
        'group flex h-8 w-full items-center gap-2 rounded-md px-2 text-start transition-colors duration-150 ease-out hover-hover:bg-[var(--surface-2)]',
        selected && 'bg-[var(--surface-3)]'
      )}
      onClick={() => onSelect(step)}
      aria-current={selected ? 'step' : undefined}
    >
      <span className='relative grid max-w-[22px] shrink-0 grid-cols-[max-content] overflow-hidden transition-[max-width] duration-150 ease-out group-hover:max-w-[128px] group-focus-visible:max-w-[128px] motion-reduce:transition-none'>
        <span className='col-start-1 row-start-1 transition-opacity duration-150 ease-out group-hover:opacity-0 group-focus-visible:opacity-0 motion-reduce:transition-none'>
          <StepTypeTag blockType={step.blockType} showLabel={false} />
        </span>
        <span className='pointer-events-none col-start-1 row-start-1 whitespace-nowrap opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none'>
          <StepTypeTag blockType={step.blockType} />
        </span>
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[var(--text-secondary)] text-small',
          selected && 'font-medium text-[var(--text-primary)]'
        )}
      >
        {step.name}
      </span>
      <span className='shrink-0 text-[var(--text-muted)] text-caption tabular-nums'>
        {step.duration}
      </span>
      <StatusIcon
        className={cn(
          'size-[13px] shrink-0 text-[var(--text-muted)]',
          step.status === 'error' && 'text-[var(--text-error)]'
        )}
      />
    </button>
  )
}

interface ErrorPreviewProps {
  run: HistoryRun
  onRetry: (run: HistoryRun) => void
  onViewRun: (run: HistoryRun) => void
}

function ErrorPreview({ run, onRetry, onViewRun }: ErrorPreviewProps) {
  const [open, setOpen] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function cancelClose() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  function scheduleClose() {
    cancelClose()
    closeTimerRef.current = setTimeout(() => setOpen(false), 140)
  }

  useEffect(() => cancelClose, [])

  if (!run.error) return <span className='text-[var(--text-muted)]'>—</span>

  const highlightedCode = highlight(run.error.code, languages.javascript, 'javascript')

  return (
    <Popover size='sm' colorScheme='inverted' open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Chip
          className='h-6 max-w-full'
          rightIcon={open ? ChevronUp : ChevronDown}
          onPointerEnter={() => {
            cancelClose()
            setOpen(true)
          }}
          onPointerLeave={scheduleClose}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label={`Preview error for ${run.label}`}
        >
          {run.error.title}
        </Chip>
      </PopoverAnchor>
      <PopoverContent
        side='bottom'
        align='start'
        sideOffset={6}
        collisionPadding={12}
        minWidth={360}
        maxWidth={440}
        className='bg-[var(--text-secondary)] shadow-overlay dark:bg-[var(--surface-7)]'
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
      >
        <div className='dark min-w-0 px-2 pt-1.5 pb-0.5'>
          <pre
            className='code-editor-theme m-0 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-[var(--text-muted-inverse)] leading-4'
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        </div>
        <div className='dark flex items-center gap-1 px-2 pt-0.5 pb-2'>
          <Chip
            variant='border-shadow'
            leftIcon={RefreshCw}
            onClick={() => {
              setOpen(false)
              onRetry(run)
            }}
          >
            Retry
          </Chip>
          <Chip
            variant='border-shadow'
            rightIcon={ChevronRight}
            onClick={() => {
              setOpen(false)
              onViewRun(run)
            }}
          >
            View full run
          </Chip>
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface RunRowProps {
  run: HistoryRun
  onRetry: (run: HistoryRun) => void
  onViewRun: (run: HistoryRun) => void
}

function RunRow({ run, onRetry, onViewRun }: RunRowProps) {
  return (
    <div
      className={cn(
        RUN_TABLE_GRID,
        'h-9 border-[var(--border)] border-b transition-colors hover-hover:bg-[var(--surface-1)]'
      )}
    >
      <div className='flex min-w-0 items-center gap-2'>
        <span className='truncate font-medium text-[var(--text-primary)] text-small'>
          {run.label}
        </span>
        <span className='truncate text-[var(--text-muted)] text-caption'>{run.time}</span>
      </div>
      <span className='truncate text-[var(--text-secondary)] text-small'>{run.trigger}</span>
      <span className='text-[var(--text-secondary)] text-small tabular-nums'>{run.duration}</span>
      <ChipTag variant={run.status === 'error' ? 'red' : 'gray'}>{statusLabel(run.status)}</ChipTag>
      <div className='min-w-0'>
        <ErrorPreview run={run} onRetry={onRetry} onViewRun={onViewRun} />
      </div>
      <span className='text-[var(--text-secondary)] text-small tabular-nums'>{run.retries}</span>
    </div>
  )
}

interface RunDrawerProps {
  run: HistoryRun
  onClose: () => void
}

function RunDrawer({ run, onClose }: RunDrawerProps) {
  const { handlePointerDown } = useOutputPanelResize()
  const initialStep = run.steps.find((step) => step.status === 'error') ?? run.steps.at(-1)!
  const [selectedStepId, setSelectedStepId] = useState(initialStep.id)
  const [activeTab, setActiveTab] = useState<DetailTab>(() => defaultTabForStep(initialStep))
  const selectedStep = run.steps.find((step) => step.id === selectedStepId) ?? initialStep
  const tabs = selectedStep.error
    ? [
        { value: 'error', label: 'Error' },
        { value: 'input', label: 'Input' },
        { value: 'output', label: 'Output' },
      ]
    : [
        { value: 'input', label: 'Input' },
        { value: 'output', label: 'Output' },
      ]
  const detailData = activeTab === 'input' ? selectedStep.input : selectedStep.output

  function selectStep(step: RunStep) {
    setSelectedStepId(step.id)
    setActiveTab(defaultTabForStep(step))
  }

  return (
    <section className='relative flex min-h-0 w-[var(--output-panel-width)] min-w-[360px] max-w-[calc(100%_-_420px)] flex-col bg-[var(--bg)]'>
      <div
        className="before:-translate-x-1/2 absolute start-[-4px] top-0 bottom-0 z-30 w-[8px] cursor-ew-resize before:absolute before:inset-y-0 before:start-1/2 before:w-[2px] before:bg-[var(--border)] before:opacity-0 before:transition-opacity before:duration-150 before:ease-out before:content-[''] hover-hover:before:opacity-100 active:before:opacity-100"
        onPointerDown={handlePointerDown}
        role='separator'
        aria-label='Resize run details'
        aria-orientation='vertical'
      />

      <div className='flex h-12 shrink-0 items-center justify-between gap-3 border-[var(--border)] border-b px-3'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <span className='truncate font-medium text-[var(--text-primary)] text-small'>
              {run.label}
            </span>
            <ChipTag variant={run.status === 'error' ? 'red' : 'gray'}>
              {statusLabel(run.status)}
            </ChipTag>
          </div>
          <p className='truncate text-[var(--text-muted)] text-caption'>
            {run.time} · {run.trigger} · {run.duration}
          </p>
        </div>
        <Chip className='h-6' leftIcon={X} onClick={onClose}>
          Close
        </Chip>
      </div>

      <div className='shrink-0 border-[var(--border)] border-b px-1 py-1'>
        <div className='flex h-7 items-center justify-between px-3'>
          <span className='font-medium text-[var(--text-secondary)] text-caption'>Steps</span>
          <span className='text-[var(--text-muted)] text-caption tabular-nums'>
            {run.steps.length}
          </span>
        </div>
        {run.steps.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            selected={selectedStep.id === step.id}
            onSelect={selectStep}
          />
        ))}
      </div>

      <div className='flex min-h-0 flex-1 flex-col'>
        <div className='flex min-h-11 shrink-0 items-center justify-between gap-3 border-[var(--border)] border-b px-3 py-2'>
          <div className='flex min-w-0 items-center gap-2'>
            <StepTypeTag blockType={selectedStep.blockType} />
            <span className='truncate font-medium text-[var(--text-primary)] text-small'>
              {selectedStep.name}
            </span>
          </div>
          <ChipModalTabs
            tabs={tabs}
            value={activeTab}
            onChange={(value) => setActiveTab(value as DetailTab)}
            aria-label='Selected step detail'
          />
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto'>
          {activeTab === 'error' && selectedStep.error && (
            <div className='space-y-3 p-4'>
              <p className='font-medium text-[var(--text-error)] text-small'>
                {selectedStep.error}
              </p>
              <p className='text-pretty text-[var(--text-secondary)] text-small leading-5'>
                {run.error?.hint}
              </p>
              <Chip
                variant='primary'
                leftIcon={RefreshCw}
                onClick={() => toast.info(`Retrying ${run.label} is shown as a prototype action`)}
              >
                Retry run
              </Chip>
            </div>
          )}

          {(activeTab === 'input' || activeTab === 'output') && (
            <Code.Viewer
              code={JSON.stringify(detailData, null, 2)}
              language='json'
              showGutter
              wrapText
              className='m-0 min-h-full rounded-none border-0 bg-[var(--bg)] dark:bg-[var(--bg)]'
            />
          )}
        </div>
      </div>
    </section>
  )
}

export function RunHistoryPrototype() {
  const { handlePointerDown } = useTerminalResize()
  const [filter, setFilter] = useState<RunFilter>('all')
  const [timeRange, setTimeRange] = useState<TimeRange>('Last 24h')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const selectedRun = RUN_HISTORY.find((run) => run.id === selectedRunId) ?? null
  const visibleRuns = RUN_HISTORY.filter((run) => filter === 'all' || run.status === filter)
  const failedRuns = RUN_HISTORY.filter((run) => run.status === 'error').length
  const completedRuns = RUN_HISTORY.length - failedRuns
  const successRate = Math.round((completedRuns / RUN_HISTORY.length) * 100)

  function retryRun(run: HistoryRun) {
    toast.info(`Retrying ${run.label} is shown as a prototype action`)
  }

  return (
    <aside
      className='terminal-container relative flex shrink-0 flex-col overflow-hidden border-[var(--border)] border-t bg-[var(--bg)]'
      aria-label='Run history prototype'
    >
      <div
        className="before:-translate-y-1/2 absolute top-[-4px] right-0 left-0 z-30 h-[8px] cursor-ns-resize before:absolute before:inset-x-0 before:top-1/2 before:h-[2px] before:bg-[var(--border)] before:opacity-0 before:transition-opacity before:duration-150 before:ease-out before:content-[''] hover-hover:before:opacity-100 active:before:opacity-100"
        onPointerDown={handlePointerDown}
        role='separator'
        aria-label='Resize logs panel'
        aria-orientation='horizontal'
      />

      <div className='flex h-[30px] shrink-0 items-center justify-between gap-3 border-[var(--border)] border-b px-4'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='font-medium text-[var(--text-primary)] text-small'>Logs</span>
          <span className='text-[var(--text-muted)] text-caption tabular-nums'>
            {visibleRuns.length} runs
          </span>
        </div>
        <div className='flex items-center gap-1'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Chip className='h-6' rightIcon={ChevronDown}>
                {RUN_FILTER_LABELS[filter]}
              </Chip>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' side='top' sideOffset={6}>
              <DropdownMenuItem onSelect={() => setFilter('all')}>All runs</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setFilter('success')}>Completed</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setFilter('error')}>Failed</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Chip className='h-6' rightIcon={ChevronDown}>
                {timeRange}
              </Chip>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' side='top' sideOffset={6}>
              <DropdownMenuItem onSelect={() => setTimeRange('Last 24h')}>
                Last 24h
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTimeRange('Last 7 days')}>
                Last 7 days
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className='flex min-h-0 flex-1'>
        <section
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col',
            selectedRun && 'border-[var(--border)] border-e'
          )}
        >
          <div className='grid h-14 shrink-0 grid-cols-4 border-[var(--border)] border-b px-4'>
            <div className='flex min-w-0 flex-col justify-center border-[var(--border)] border-e pe-4'>
              <span className='text-[var(--text-muted)] text-caption'>Runs</span>
              <span className='font-medium text-[var(--text-primary)] text-small tabular-nums'>
                {RUN_HISTORY.length}
              </span>
            </div>
            <div className='flex min-w-0 flex-col justify-center border-[var(--border)] border-e px-4'>
              <span className='text-[var(--text-muted)] text-caption'>Success</span>
              <span className='font-medium text-[var(--text-primary)] text-small tabular-nums'>
                {successRate}%
              </span>
            </div>
            <div className='flex min-w-0 flex-col justify-center border-[var(--border)] border-e px-4'>
              <span className='text-[var(--text-muted)] text-caption'>Failed</span>
              <span className='font-medium text-[var(--text-error)] text-small tabular-nums'>
                {failedRuns}
              </span>
            </div>
            <div className='flex min-w-0 flex-col justify-center ps-4'>
              <span className='text-[var(--text-muted)] text-caption'>Avg duration</span>
              <span className='font-medium text-[var(--text-primary)] text-small tabular-nums'>
                7.6s
              </span>
            </div>
          </div>

          <div className='min-h-0 flex-1 overflow-auto'>
            <div
              className={cn(
                RUN_TABLE_GRID,
                'sticky top-0 z-10 h-8 border-[var(--border)] border-b bg-[var(--surface-1)] text-[var(--text-muted)] text-caption'
              )}
            >
              <span>Run</span>
              <span>Trigger</span>
              <span>Duration</span>
              <span>Status</span>
              <span>Error</span>
              <span>Retries</span>
            </div>
            {visibleRuns.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                onRetry={retryRun}
                onViewRun={(nextRun) => setSelectedRunId(nextRun.id)}
              />
            ))}
          </div>
        </section>

        {selectedRun && (
          <RunDrawer
            key={selectedRun.id}
            run={selectedRun}
            onClose={() => setSelectedRunId(null)}
          />
        )}
      </div>
    </aside>
  )
}
