'use client'

import { useState } from 'react'
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
import { Check, ChevronDown, CircleX, RefreshCw } from '@sim/emcn/icons'
import { WorkflowTypeTag } from '@sim/workflow-renderer'
import {
  useOutputPanelResize,
  useTerminalResize,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/hooks'
import { hasBlockAccent } from '@/blocks/accent'
import { getBlock } from '@/blocks/registry'

type MinimalRunId = 'failed' | 'successful'
type MinimalStatus = 'success' | 'error'
type MinimalTab = 'error' | 'input' | 'output'

interface MinimalStep {
  id: string
  name: string
  blockType: string
  status: MinimalStatus
  duration: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  error?: string
}

interface MinimalRun {
  id: MinimalRunId
  label: string
  time: string
  trigger: string
  status: MinimalStatus
  duration: string
  steps: MinimalStep[]
}

const MINIMAL_RUNS: Record<MinimalRunId, MinimalRun> = {
  failed: {
    id: 'failed',
    label: 'Latest run',
    time: 'Today at 10:42 AM',
    trigger: 'Manual',
    status: 'error',
    duration: '8.4s',
    steps: [
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
        input: { prospect: 'Avery Chen', company: 'Northstar' },
        output: { message: 'Hi Avery — I enjoyed your recent product design talk…' },
      },
      {
        id: 'send',
        name: 'Send Slack message',
        blockType: 'slack',
        status: 'error',
        duration: '1.6s',
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
        id: 'trigger',
        name: 'Scheduled trigger',
        blockType: 'start_trigger',
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
        input: { prospect: 'Morgan Lee', company: 'Arcade' },
        output: { message: 'Hi Morgan — your team’s recent launch stood out…' },
      },
      {
        id: 'send',
        name: 'Send Slack message',
        blockType: 'slack',
        status: 'success',
        duration: '1.3s',
        input: { channel: '#product-leads', message: 'Hi Morgan — your recent launch stood out…' },
        output: { sent: true, channel: '#product-leads' },
      },
    ],
  },
}

function statusLabel(status: MinimalStatus): string {
  return status === 'error' ? 'Failed' : 'Completed'
}

function defaultTabForStep(step: MinimalStep): MinimalTab {
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

interface MinimalStepRowProps {
  step: MinimalStep
  selected: boolean
  onSelect: (step: MinimalStep) => void
}

function MinimalStepRow({ step, selected, onSelect }: MinimalStepRowProps) {
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

export function LogsOverviewPrototype() {
  const { handlePointerDown: handleTerminalResizePointerDown } = useTerminalResize()
  const { handlePointerDown: handleDetailResizePointerDown } = useOutputPanelResize()
  const [runId, setRunId] = useState<MinimalRunId>('failed')
  const run = MINIMAL_RUNS[runId]
  const [selectedStepId, setSelectedStepId] = useState('send')
  const selectedStep = run.steps.find((step) => step.id === selectedStepId) ?? run.steps[0]
  const [activeTab, setActiveTab] = useState<MinimalTab>(() => defaultTabForStep(selectedStep))

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

  function selectStep(step: MinimalStep) {
    setSelectedStepId(step.id)
    setActiveTab(defaultTabForStep(step))
  }

  function selectRun(nextRunId: MinimalRunId) {
    const nextRun = MINIMAL_RUNS[nextRunId]
    const nextSelectedStep =
      nextRun.steps.find((step) => step.status === 'error') ?? nextRun.steps.at(-1)!

    setRunId(nextRunId)
    setSelectedStepId(nextSelectedStep.id)
    setActiveTab(defaultTabForStep(nextSelectedStep))
  }

  return (
    <aside
      className='terminal-container relative flex shrink-0 flex-col overflow-hidden border-[var(--border)] border-t bg-[var(--bg)]'
      aria-label='Minimal logs prototype'
    >
      <div
        className="before:-translate-y-1/2 absolute top-[-4px] right-0 left-0 z-30 h-[8px] cursor-ns-resize before:absolute before:inset-x-0 before:top-1/2 before:h-[2px] before:bg-[var(--border)] before:opacity-0 before:transition-opacity before:duration-150 before:ease-out before:content-[''] hover-hover:before:opacity-100 active:before:opacity-100"
        onPointerDown={handleTerminalResizePointerDown}
        role='separator'
        aria-label='Resize logs panel'
        aria-orientation='horizontal'
      />

      <div className='flex h-[30px] shrink-0 items-center justify-between gap-3 border-[var(--border)] border-b px-4'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='shrink-0 font-medium text-[var(--text-primary)] text-small'>Logs</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Chip className='h-6' rightIcon={ChevronDown}>
                {run.label}
              </Chip>
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
          <ChipTag variant={run.status === 'error' ? 'red' : 'gray'}>
            {statusLabel(run.status)}
          </ChipTag>
          <span className='hidden truncate text-[var(--text-muted)] text-caption min-[760px]:inline'>
            {run.time} · {run.trigger} · {run.duration}
          </span>
        </div>
        {run.status === 'error' && (
          <Chip
            className='h-6'
            variant='primary'
            leftIcon={RefreshCw}
            onClick={() => toast.info('Retry is shown here as a prototype action')}
          >
            Retry
          </Chip>
        )}
      </div>

      <div className='flex min-h-0 flex-1'>
        <section className='flex min-h-0 min-w-[280px] flex-1 flex-col border-[var(--border)] border-e'>
          <div className='flex h-9 shrink-0 items-center justify-between px-4'>
            <span className='font-medium text-[var(--text-secondary)] text-caption'>Steps</span>
            <span className='text-[var(--text-muted)] text-caption tabular-nums'>
              {run.steps.length}
            </span>
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto px-1 pb-1'>
            {run.steps.map((step) => (
              <MinimalStepRow
                key={step.id}
                step={step}
                selected={selectedStep.id === step.id}
                onSelect={selectStep}
              />
            ))}
          </div>
        </section>

        <section className='relative flex min-h-0 w-[var(--output-panel-width)] min-w-[320px] max-w-[calc(100%_-_280px)] flex-col'>
          <div
            className="before:-translate-x-1/2 absolute start-[-4px] top-0 bottom-0 z-30 w-[8px] cursor-ew-resize before:absolute before:inset-y-0 before:start-1/2 before:w-[2px] before:bg-[var(--border)] before:opacity-0 before:transition-opacity before:duration-150 before:ease-out before:content-[''] hover-hover:before:opacity-100 active:before:opacity-100"
            onPointerDown={handleDetailResizePointerDown}
            role='separator'
            aria-label='Resize step list and step details'
            aria-orientation='vertical'
          />

          <div className='flex min-h-12 shrink-0 items-center justify-between gap-3 border-[var(--border)] border-b px-3 py-2'>
            <div className='flex min-w-0 items-center gap-2'>
              <StepTypeTag blockType={selectedStep.blockType} />
              <div className='min-w-0'>
                <div className='flex items-center gap-1.5'>
                  <span className='truncate font-medium text-[var(--text-primary)] text-small'>
                    {selectedStep.name}
                  </span>
                  {selectedStep.status === 'error' && (
                    <CircleX className='size-[13px] shrink-0 text-[var(--text-error)]' />
                  )}
                </div>
                <span className='text-[var(--text-muted)] text-caption tabular-nums'>
                  {selectedStep.duration}
                </span>
              </div>
            </div>
            <ChipModalTabs
              tabs={tabs}
              value={activeTab}
              onChange={(value) => setActiveTab(value as MinimalTab)}
              aria-label='Selected step detail'
            />
          </div>

          <div className='min-h-0 flex-1 overflow-y-auto'>
            {activeTab === 'error' && selectedStep.error && (
              <div className='max-w-[560px] space-y-4 p-4'>
                <div>
                  <p className='font-medium text-[var(--text-error)] text-small'>
                    {selectedStep.error}
                  </p>
                  <p className='mt-1 text-pretty text-[var(--text-secondary)] text-small leading-5'>
                    Check that the channel exists and the connection can post to it.
                  </p>
                </div>
                <Chip
                  variant='border'
                  onClick={() => toast.info('This would select the block in the editor')}
                >
                  Open block
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
        </section>
      </div>
    </aside>
  )
}
