'use client'

import { useMemo, useState } from 'react'
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
  toast,
} from '@sim/emcn'
import {
  Check,
  ChevronDown,
  CircleX,
  RefreshCw,
  SquareArrowUpRight,
  Workflow,
} from '@sim/emcn/icons'
import { EntryBlockTile } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components'
import {
  useOutputPanelResize,
  useTerminalResize,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/hooks'

type PrototypeRunId = 'failed' | 'successful'
type PrototypeStatus = 'success' | 'error'
type PrototypeTab = 'summary' | 'error' | 'input' | 'output'

interface PrototypeStep {
  id: string
  name: string
  blockType: string
  status: PrototypeStatus
  duration: string
  depth?: number
  input: Record<string, unknown>
  output: Record<string, unknown>
  error?: string
}

interface PrototypeRun {
  id: PrototypeRunId
  label: string
  time: string
  trigger: string
  status: PrototypeStatus
  duration: string
  steps: PrototypeStep[]
}

const PROTOTYPE_RUNS: Record<PrototypeRunId, PrototypeRun> = {
  failed: {
    id: 'failed',
    label: 'Latest run',
    time: 'Today at 10:42 AM',
    trigger: 'Manual',
    status: 'error',
    duration: '8.4s',
    steps: [
      {
        id: 'run',
        name: 'Mega Pipeline',
        blockType: 'workflow',
        status: 'error',
        duration: '8.4s',
        input: { campaign: 'Design leaders', limit: 25 },
        output: { completed: 3, failed: 1, status: 'failed' },
        error: 'The workflow stopped because “Send Slack message” failed.',
      },
      {
        id: 'trigger',
        name: 'Manual trigger',
        blockType: 'starter',
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
        duration: '1.2s',
        input: { query: 'VP Design OR Head of Design', limit: 25 },
        output: { results: 25, source: 'Google Search' },
      },
      {
        id: 'draft',
        name: 'Draft outreach message',
        blockType: 'agent',
        status: 'success',
        duration: '5.5s',
        depth: 1,
        input: { prospect: 'Avery Chen', company: 'Northstar' },
        output: { message: 'Hi Avery — I enjoyed your recent product design talk…' },
      },
      {
        id: 'send',
        name: 'Send Slack message',
        blockType: 'slack',
        status: 'error',
        duration: '1.6s',
        depth: 1,
        input: { channel: '#design-leads', message: 'Hi Avery — I enjoyed your recent talk…' },
        output: { sent: false },
        error: 'Slack returned channel_not_found for “#design-leads”.',
      },
    ],
  },
  successful: {
    id: 'successful',
    label: 'Previous run',
    time: 'Today at 9:18 AM',
    trigger: 'Schedule',
    status: 'success',
    duration: '6.9s',
    steps: [
      {
        id: 'run',
        name: 'Mega Pipeline',
        blockType: 'workflow',
        status: 'success',
        duration: '6.9s',
        input: { campaign: 'Product leaders', limit: 10 },
        output: { completed: 10, failed: 0, status: 'completed' },
      },
      {
        id: 'trigger',
        name: 'Scheduled trigger',
        blockType: 'starter',
        status: 'success',
        duration: '0.1s',
        input: { schedule: 'Weekdays at 9:00 AM' },
        output: { accepted: true },
      },
      {
        id: 'search',
        name: 'Search prospects',
        blockType: 'google_search',
        status: 'success',
        duration: '1.1s',
        input: { query: 'VP Product OR Head of Product', limit: 10 },
        output: { results: 10, source: 'Google Search' },
      },
      {
        id: 'draft',
        name: 'Draft outreach message',
        blockType: 'agent',
        status: 'success',
        duration: '4.4s',
        depth: 1,
        input: { prospect: 'Morgan Lee', company: 'Arcade' },
        output: { message: 'Hi Morgan — your team’s recent launch stood out…' },
      },
      {
        id: 'send',
        name: 'Send Slack message',
        blockType: 'slack',
        status: 'success',
        duration: '1.3s',
        depth: 1,
        input: { channel: '#product-leads', message: 'Hi Morgan — your recent launch stood out…' },
        output: { sent: true, channel: '#product-leads' },
      },
    ],
  },
}

function statusLabel(status: PrototypeStatus): string {
  return status === 'error' ? 'Failed' : 'Completed'
}

function defaultTabForStep(step: PrototypeStep): PrototypeTab {
  if (step.error) return 'error'
  if (step.id === 'run') return 'summary'
  return 'output'
}

interface TraceRowProps {
  step: PrototypeStep
  selected: boolean
  onSelect: (step: PrototypeStep) => void
}

function TraceRow({ step, selected, onSelect }: TraceRowProps) {
  const StatusIcon = step.status === 'error' ? CircleX : Check

  return (
    <button
      type='button'
      className={cn(
        'group flex h-8 w-full items-center gap-2 px-3 text-start transition-colors hover-hover:bg-[var(--surface-2)]',
        step.depth === 1 && 'ps-8',
        selected && 'bg-[var(--surface-3)]'
      )}
      onClick={() => onSelect(step)}
      aria-current={selected ? 'true' : undefined}
    >
      {step.id === 'run' ? (
        <span className='flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-[var(--surface-3)]'>
          <Workflow className='size-[12px] text-[var(--text-icon)]' />
        </span>
      ) : (
        <EntryBlockTile blockType={step.blockType} />
      )}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-small',
          step.status === 'error' ? 'text-[var(--text-error)]' : 'text-[var(--text-secondary)]',
          selected && 'text-[var(--text-primary)]'
        )}
      >
        {step.name}
      </span>
      <StatusIcon
        className={cn(
          'size-[13px] shrink-0',
          step.status === 'error' ? 'text-[var(--text-error)]' : 'text-[var(--text-success)]'
        )}
      />
      <span className='w-9 shrink-0 text-end text-[var(--text-muted)] text-caption'>
        {step.duration}
      </span>
    </button>
  )
}

export function LogsPanelPrototype() {
  const { handlePointerDown: handleTerminalResizePointerDown } = useTerminalResize()
  const { handlePointerDown: handleDetailResizePointerDown } = useOutputPanelResize()
  const [runId, setRunId] = useState<PrototypeRunId>('failed')
  const run = PROTOTYPE_RUNS[runId]
  const [selectedStepId, setSelectedStepId] = useState('send')
  const selectedStep = run.steps.find((step) => step.id === selectedStepId) ?? run.steps[0]
  const [activeTab, setActiveTab] = useState<PrototypeTab>(() => defaultTabForStep(selectedStep))

  const tabs = useMemo(() => {
    if (selectedStep.id === 'run') {
      return [
        { value: 'summary', label: 'Summary' },
        { value: 'input', label: 'Input' },
        { value: 'output', label: 'Output' },
      ]
    }

    return [
      ...(selectedStep.error ? [{ value: 'error', label: 'Error' }] : []),
      { value: 'input', label: 'Input' },
      { value: 'output', label: 'Output' },
    ]
  }, [selectedStep])

  function selectStep(step: PrototypeStep) {
    setSelectedStepId(step.id)
    setActiveTab(defaultTabForStep(step))
  }

  function selectRun(nextRunId: PrototypeRunId) {
    const nextRun = PROTOTYPE_RUNS[nextRunId]
    const nextSelectedStep = nextRun.status === 'error' ? nextRun.steps.at(-1)! : nextRun.steps[0]
    setRunId(nextRunId)
    setSelectedStepId(nextSelectedStep.id)
    setActiveTab(defaultTabForStep(nextSelectedStep))
  }

  const detailData = activeTab === 'input' ? selectedStep.input : selectedStep.output

  return (
    <aside
      className='terminal-container relative flex shrink-0 flex-col overflow-hidden border-[var(--border)] border-t bg-[var(--bg)]'
      aria-label='Logs panel layout prototype'
    >
      <div
        className="before:-translate-y-1/2 absolute top-[-4px] right-0 left-0 z-30 h-[8px] cursor-ns-resize before:absolute before:inset-x-0 before:top-1/2 before:h-[2px] before:bg-[var(--border)] before:opacity-0 before:transition-opacity before:duration-150 before:ease-out before:content-[''] hover-hover:before:opacity-100 active:before:opacity-100"
        onPointerDown={handleTerminalResizePointerDown}
        role='separator'
        aria-label='Resize logs panel'
        aria-orientation='horizontal'
      />
      <div className='flex h-[30px] shrink-0 items-center justify-between gap-3 border-[var(--border)] border-b px-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='shrink-0 font-medium text-[var(--text-primary)] text-small'>Logs</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Chip rightIcon={ChevronDown}>{run.label}</Chip>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' side='top' sideOffset={6}>
              <DropdownMenuItem onSelect={() => selectRun('failed')}>
                Latest run · Failed · 10:42 AM
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => selectRun('successful')}>
                Previous run · Completed · 9:18 AM
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ChipTag variant={run.status === 'error' ? 'red' : 'green'}>
            {statusLabel(run.status)}
          </ChipTag>
          <span className='hidden truncate text-[var(--text-muted)] text-caption min-[980px]:inline'>
            {run.time} · {run.trigger} · {run.duration}
          </span>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          {run.status === 'error' && (
            <Chip
              variant='primary'
              leftIcon={RefreshCw}
              onClick={() => toast.info('Retry is shown here as a prototype action')}
            >
              Retry
            </Chip>
          )}
          <Chip
            variant='border'
            rightIcon={SquareArrowUpRight}
            onClick={() => toast.info('This would open the full Logs page')}
          >
            Full logs
          </Chip>
        </div>
      </div>

      <div className='flex min-h-0 flex-1'>
        <section className='flex min-h-0 min-w-[240px] flex-1 flex-col border-[var(--border)] border-e'>
          <div className='flex h-9 shrink-0 items-center justify-between px-3'>
            <span className='font-medium text-[var(--text-secondary)] text-caption'>
              Execution trace
            </span>
            <span className='text-[var(--text-muted)] text-caption'>{run.steps.length} steps</span>
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto py-1'>
            {run.steps.map((step, index) => (
              <div key={step.id}>
                {index === 1 && <div className='mx-3 my-1 border-[var(--border)] border-t' />}
                <TraceRow
                  step={step}
                  selected={selectedStep.id === step.id}
                  onSelect={selectStep}
                />
              </div>
            ))}
          </div>
        </section>

        <section className='relative flex min-h-0 w-[var(--output-panel-width)] min-w-[280px] max-w-[calc(100%_-_240px)] flex-col'>
          <div
            className="before:-translate-x-1/2 absolute start-[-4px] top-0 bottom-0 z-30 w-[8px] cursor-ew-resize before:absolute before:inset-y-0 before:start-1/2 before:w-[2px] before:bg-[var(--border)] before:opacity-0 before:transition-opacity before:duration-150 before:ease-out before:content-[''] hover-hover:before:opacity-100 active:before:opacity-100"
            onPointerDown={handleDetailResizePointerDown}
            role='separator'
            aria-label='Resize execution trace and step details'
            aria-orientation='vertical'
          />
          <div className='flex min-h-12 shrink-0 items-center justify-between gap-3 border-[var(--border)] border-b px-3 py-2'>
            <div className='min-w-0'>
              <div className='flex items-center gap-2'>
                <span className='truncate font-medium text-[var(--text-primary)] text-small'>
                  {selectedStep.name}
                </span>
                <ChipTag variant={selectedStep.status === 'error' ? 'red' : 'green'}>
                  {statusLabel(selectedStep.status)}
                </ChipTag>
              </div>
              <span className='text-[var(--text-muted)] text-caption'>
                {selectedStep.id === 'run'
                  ? 'Run details'
                  : `Step details · ${selectedStep.duration}`}
              </span>
            </div>
            <ChipModalTabs
              tabs={tabs}
              value={activeTab}
              onChange={(value) => setActiveTab(value as PrototypeTab)}
              aria-label='Selected execution detail'
            />
          </div>

          <div className='min-h-0 flex-1 overflow-y-auto'>
            {activeTab === 'summary' && (
              <div className='grid gap-5 p-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <p className='font-medium text-[var(--text-primary)] text-small'>Run summary</p>
                  <dl className='grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-caption'>
                    <dt className='text-[var(--text-muted)]'>Status</dt>
                    <dd className='text-[var(--text-secondary)]'>{statusLabel(run.status)}</dd>
                    <dt className='text-[var(--text-muted)]'>Started</dt>
                    <dd className='text-[var(--text-secondary)]'>{run.time}</dd>
                    <dt className='text-[var(--text-muted)]'>Trigger</dt>
                    <dd className='text-[var(--text-secondary)]'>{run.trigger}</dd>
                    <dt className='text-[var(--text-muted)]'>Duration</dt>
                    <dd className='text-[var(--text-secondary)]'>{run.duration}</dd>
                  </dl>
                </div>
                <div className='space-y-2'>
                  <p className='font-medium text-[var(--text-primary)] text-small'>What happened</p>
                  <p className='max-w-[52ch] text-[var(--text-secondary)] text-small leading-5'>
                    {selectedStep.error ??
                      `All ${run.steps.length - 1} workflow steps completed successfully.`}
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'error' && selectedStep.error && (
              <div className='space-y-4 p-4'>
                <div className='max-w-[720px] space-y-2'>
                  <p className='font-medium text-[var(--text-error)] text-small'>
                    {selectedStep.error}
                  </p>
                  <p className='text-[var(--text-secondary)] text-small leading-5'>
                    Check that the Slack channel exists and that the connected workspace can post to
                    it. The earlier steps completed successfully, so retrying can resume from this
                    failure.
                  </p>
                </div>
                <div className='flex flex-wrap gap-2'>
                  <Chip
                    variant='primary'
                    onClick={() => toast.info('This would send the failure context to Chat')}
                  >
                    Fix in Chat
                  </Chip>
                  <Chip
                    variant='border'
                    onClick={() => toast.info('This would select the block in the editor')}
                  >
                    Open block
                  </Chip>
                </div>
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
        </section>
      </div>
    </aside>
  )
}
