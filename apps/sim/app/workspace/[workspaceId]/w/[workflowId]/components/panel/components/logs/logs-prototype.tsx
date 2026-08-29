'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Chip, ChipTag, cn, toast, useCopyToClipboard } from '@sim/emcn'
import { ArrowLeft, Check, ChevronDown, Code, Duplicate } from '@sim/emcn/icons'
import { getWorkflowTypeAccent } from '@sim/workflow-renderer'
import { useSearchParams } from 'next/navigation'
import {
  flattenRunSteps,
  formatMs,
  formatRunTime,
  formatUsd,
  getRunRetryCount,
  getRunSkippedCount,
  getRunSteps,
  PROTOTYPE_RUNS,
  PROTOTYPE_WORKFLOW_STATE,
  type PrototypeRun,
  type PrototypeRunStatus,
  type PrototypeRunStepView,
  STEP_INDENT_PX,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/logs/prototype-data'
import {
  RunStat,
  RunStatusBadge,
  StatusIcon,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/logs/run-status'
import { RunsOverview } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/logs/runs-overview'
import { getBlock } from '@/blocks'
import { hasBlockAccent } from '@/blocks/accent'
import { getTileIconColorClass } from '@/blocks/icon-color'
import { useWorkflowRunSnapshotStore } from '@/stores/logs/workflow-run-snapshot'

function formatVersion(run: PrototypeRun) {
  return run.deploymentVersionName ?? `v${run.deploymentVersion}`
}

/** A paused run is stalled on input, not finished — it has no duration to report yet. */
function isRunSettled(status: PrototypeRunStatus) {
  return status === 'success' || status === 'error'
}

/** How far a nested row's hover pulls back from the panel edges. */
const NESTED_HOVER_INSET_PX = 6

export function StepIcon({ blockType }: { blockType: string | undefined }) {
  const config = blockType ? getBlock(blockType) : null
  const Icon = config?.icon
  if (!config || !Icon) return null

  if (hasBlockAccent(config.type)) {
    const accent = getWorkflowTypeAccent(config.type)
    return (
      <ChipTag
        variant={accent.variant}
        tone={accent.tone}
        className='size-[16px] flex-none justify-center p-0'
      >
        <Icon className='size-[10px]' />
      </ChipTag>
    )
  }

  return (
    <div
      className='relative flex size-[16px] flex-none items-center justify-center overflow-hidden rounded-sm [&_img]:size-full'
      /* Brand fill comes from the block registry, the same value the card uses. */
      style={{ background: config.bgColor }}
    >
      <Icon className={cn('size-[10px]', getTileIconColorClass(config.bgColor))} />
    </div>
  )
}

/**
 * An identifier you are meant to take somewhere else, so the value itself is the
 * button rather than a separate icon target — the whole string is the hit area,
 * and the trailing glyph confirms the copy landed.
 */
function CopyableId({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopyToClipboard()

  return (
    <button
      type='button'
      onClick={() => copy(value)}
      title={value}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className='group/copy flex min-w-0 items-center gap-1.5 rounded-sm text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-primary)]'
    >
      <span className='min-w-0 truncate font-mono'>{value}</span>
      {copied ? (
        <Check className='size-[12px] flex-none text-[var(--text-primary)]' />
      ) : (
        <Duplicate className='size-[12px] flex-none text-[var(--text-icon)] transition-colors group-hover/copy:text-[var(--text-primary)]' />
      )}
    </button>
  )
}

interface RunDetailProps {
  run: PrototypeRun
  selectedBlockId: string | null
  selectedStepId: string | null
  onBack: () => void
  onSelectStep: (blockId: string, stepId: string) => void
  onOpenDiagnostics: () => void
  inspectorOpen: boolean
  onToggleInspector: () => void
}

/**
 * Proportional band of the run: one lane per step, sized by how long it took.
 * Skipped steps still occupy a sliver so the shape of an aborted run reads at a
 * glance — a short coloured head followed by a long dim tail.
 */
function RunTimeline({ steps }: { steps: PrototypeRunStepView[] }) {
  const total = steps.reduce((sum, step) => sum + step.durationMs, 0)

  return (
    <div className='flex h-2 gap-0.5 overflow-hidden' aria-hidden='true'>
      {steps.map((step) => (
        <span
          key={step.id}
          /* Width is data, not design — the palette stays in the classes below. */
          style={{ flexGrow: total > 0 && step.durationMs > 0 ? step.durationMs / total : 0.06 }}
          className={cn(
            'min-w-[3px] flex-shrink-0 rounded-[2px] bg-[var(--text-success)]',
            step.status === 'warning' && 'bg-[var(--warning)]',
            step.status === 'error' && 'bg-[var(--text-error)]',
            step.status === 'skipped' && 'bg-[var(--border)]'
          )}
        />
      ))}
    </div>
  )
}

function RunDetail({
  run,
  selectedBlockId,
  selectedStepId,
  onBack,
  onSelectStep,
  onOpenDiagnostics,
  inspectorOpen,
  onToggleInspector,
}: RunDetailProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  /** Steps whose nested work is showing. Collapsed by default: the workflow's own
   *  steps are the outline, and an agent's model turns are detail you opt into. */
  const [expandedSteps, setExpandedSteps] = useState<ReadonlySet<string>>(new Set())
  const steps = getRunSteps(run)
  const stepRows = flattenRunSteps(steps, expandedSteps)
  const failedStep = steps.find((step) => step.status === 'error')

  /**
   * Keeps the two halves in step when the canvas drives the selection: a block
   * picked out there scrolls its row into view here.
   */
  const toggleStep = (stepId: string) => {
    setExpandedSteps((current) => {
      const next = new Set(current)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }

  useEffect(() => {
    if (!selectedBlockId) return
    scrollRef.current
      ?.querySelector(`[data-step-block-id="${selectedBlockId}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedBlockId])
  const retries = getRunRetryCount(run)
  const skipped = getRunSkippedCount(run)

  const stats = [
    // A run still going has elapsed time, not a duration.
    { label: isRunSettled(run.status) ? 'Duration' : 'Elapsed', value: formatMs(run.durationMs) },
    { label: 'Steps', value: `${steps.length - skipped} of ${steps.length}` },
    { label: 'Retries', value: String(retries) },
    { label: 'Cost', value: formatUsd(run.costUsd) },
  ]

  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden'>
      <div className='flex h-11 flex-none items-center gap-2 border-[var(--border)] border-b px-3'>
        <Chip
          leftIcon={ArrowLeft}
          onClick={onBack}
          aria-label='Back to workflow runs'
          className='size-[30px] justify-center p-0'
        />
        <p className='min-w-0 flex-1 truncate font-medium text-[var(--text-primary)] text-small'>
          {run.label}
        </p>
        <RunStatusBadge status={run.status} />
      </div>

      <div ref={scrollRef} className='min-h-0 flex-1 overflow-y-auto'>
        <section className='border-[var(--border)] border-b px-3 py-3'>
          <RunTimeline steps={steps} />
          <div className='mt-1.5 flex justify-between text-[var(--text-muted)] text-caption tabular-nums'>
            <span>0s</span>
            <span>{formatMs(run.durationMs)}</span>
          </div>
          <div className='mt-3 grid grid-cols-2 gap-1.5'>
            {stats.map((stat) => (
              <RunStat key={stat.label} label={stat.label} value={stat.value} />
            ))}
          </div>

          {/* The run's identity — what the old Log Details carried on its Overview tab. */}
          <dl className='mt-3 space-y-1.5 text-caption'>
            <div className='flex items-center justify-between gap-3'>
              <dt className='flex-none text-[var(--text-tertiary)]'>Started</dt>
              <dd className='truncate text-[var(--text-primary)]'>
                {formatRunTime(run.startedAt)}
              </dd>
            </div>
            <div className='flex items-center justify-between gap-3'>
              <dt className='flex-none text-[var(--text-tertiary)]'>Trigger</dt>
              <dd className='truncate text-[var(--text-primary)]'>{run.trigger}</dd>
            </div>
            <div className='flex items-center justify-between gap-3'>
              <dt className='flex-none text-[var(--text-tertiary)]'>Version</dt>
              <dd className='truncate text-[var(--text-primary)] tabular-nums'>
                {formatVersion(run)}
              </dd>
            </div>
            <div className='flex items-center justify-between gap-3'>
              <dt className='flex-none text-[var(--text-tertiary)]'>Run ID</dt>
              <dd className='min-w-0'>
                <CopyableId value={run.runId} label='Run ID' />
              </dd>
            </div>
          </dl>
        </section>

        <section className='py-3'>
          <div className='mb-2 flex items-center justify-between gap-2 px-3'>
            <h3 className='font-medium text-[var(--text-primary)] text-small'>Execution</h3>
            {/*
             * The inspector is a place, not a per-row action: opened once from here,
             * it then follows whichever step is selected. That is why no row carries
             * its own control — selecting the row is the gesture.
             */}
            <Chip
              size='sm'
              leftIcon={Code}
              active={inspectorOpen}
              aria-pressed={inspectorOpen}
              onClick={onToggleInspector}
            >
              Inspector
            </Chip>
          </div>
          <div>
            {stepRows.map((step, rowIndex) => {
              const isExpanded = expandedSteps.has(step.id)
              /* The last child of an expanded group; the group needs room under it. */
              const closesNesting = step.depth > 0 && (stepRows[rowIndex + 1]?.depth ?? 0) === 0
              const blockType = PROTOTYPE_WORKFLOW_STATE.blocks[step.blockId]?.type
              /* A nested row is its own subject; only without one does the block
                 stand in, so a click on the canvas still lights up its step. */
              const selected = selectedStepId
                ? selectedStepId === step.id
                : selectedBlockId === step.blockId
              const offset = run.durationMs > 0 ? (step.startMs / run.durationMs) * 100 : 0
              const width = run.durationMs > 0 ? (step.durationMs / run.durationMs) * 100 : 0
              return (
                <div
                  key={step.id}
                  className={cn(
                    /*
                     * Selection stays full-bleed — it marks the row as the canvas's
                     * subject, and a band is the clearest way to say so.
                     */
                    'transition-colors',
                    selected && 'bg-[var(--surface-hover)]',
                    /* Padding sits outside the hover box, so the gap stays empty. */
                    closesNesting && 'pb-2'
                  )}
                >
                  {/* The row and its error card hover as one unit — the card is part of
                      the failure, not a separate thing beside it. The wrapper's bottom
                      padding stays outside this box so the gap under a nested group
                      never lights up.

                      An open group is banded in the same fill a selected row takes, so
                      the nesting reads as one block rather than as loose rows, and the
                      inset hover on a child has something to sit against. */}
                  <div
                    className={cn(
                      'group/row relative',
                      step.depth > 0 && !selected && 'bg-[var(--surface-hover)]'
                    )}
                  >
                    {/*
                     * Hover is its own layer rather than a background on the row. Only
                     * nested work is inset and rounded — a top-level row runs the panel's
                     * full width, where corners would cut into its own edges. The fill
                     * must land lighter than the selected band it can sit on, and the
                     * surface scale runs opposite ways between themes, so dark is named.
                     */}
                    <span
                      aria-hidden='true'
                      style={{
                        insetInlineStart: step.depth > 0 ? NESTED_HOVER_INSET_PX : 0,
                        insetInlineEnd: step.depth > 0 ? NESTED_HOVER_INSET_PX : 0,
                      }}
                      className={cn(
                        'pointer-events-none absolute inset-y-0 bg-[var(--surface-4)] opacity-0 transition-opacity duration-150 ease-out group-hover/row:opacity-100 motion-reduce:transition-none dark:bg-[var(--surface-5)]',
                        step.depth > 0 && 'rounded-lg'
                      )}
                    />
                    <button
                      type='button'
                      data-step-block-id={step.blockId}
                      onClick={() => {
                        onSelectStep(step.blockId, step.id)
                        if (step.hasChildren) toggleStep(step.id)
                      }}
                      /* Nesting is expressed by indent, the way the Logs trace view does it. */
                      style={{ paddingInlineStart: 12 + step.depth * STEP_INDENT_PX }}
                      className='group relative flex w-full gap-2 py-2 pe-3 text-start focus-visible:bg-[var(--surface-active)] focus-visible:outline-none'
                    >
                      {/* Every workflow step keeps its ordinal — a gap in the sequence
                        where a step happened to nest read as a missing step. */}
                      <span className='flex h-5 w-3 flex-none items-center justify-center text-[var(--text-muted)] text-caption tabular-nums'>
                        {step.depth === 0 ? step.index + 1 : null}
                      </span>
                      {/*
                       * Icon, name and bar share one column, so the bar starts where the
                       * icon does because they are siblings — not because an `ml-5`
                       * happened to land there.
                       */}
                      <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
                        <div className='flex w-full min-w-0 items-center gap-2'>
                          {step.depth === 0 ? (
                            <StepIcon blockType={blockType} />
                          ) : (
                            <span className='flex-none text-[var(--text-tertiary)] text-caption'>
                              {step.type}
                            </span>
                          )}
                          {/*
                           * States both things nesting needs to say: that there is more
                           * inside, and how much. The count answers "is this worth
                           * opening", the chevron answers "can I". Sitting beside the name
                           * rather than in a reserved column means rows with nothing nested
                           * carry nothing at all.
                           */}
                          {step.hasChildren ? (
                            <span className='flex flex-none items-center gap-0.5 rounded-md bg-[var(--surface-4)] py-[1px] ps-0.5 pe-1 text-[var(--text-tertiary)] text-caption tabular-nums'>
                              <ChevronDown
                                className={cn(
                                  'size-3 transition-transform duration-200 ease-out motion-reduce:transition-none',
                                  !isExpanded && '-rotate-90'
                                )}
                              />
                              {step.children?.length ?? 0}
                            </span>
                          ) : null}
                          <span className='min-w-0 flex-1 truncate text-[var(--text-primary)] text-sm'>
                            {step.name}
                          </span>
                          <span className='text-[var(--text-tertiary)] text-caption tabular-nums'>
                            {formatMs(step.durationMs)}
                          </span>
                          <StatusIcon status={step.status} />
                        </div>
                        {/* The summary bar above states the whole run, so a single step's slice
                        sits at half its height with corners scaled to match. Same
                        language, plainly subordinate to it. */}
                        <div className='h-1 min-w-0 overflow-hidden rounded-[1px] bg-[var(--border)]'>
                          {step.durationMs > 0 ? (
                            <span
                              /* Position and length come from the run's own timings. */
                              style={{ marginInlineStart: `${offset}%`, width: `${width}%` }}
                              className={cn(
                                'block h-full min-w-[2px] rounded-[1px] bg-[var(--text-success)]',
                                step.status === 'warning' && 'bg-[var(--warning)]',
                                step.status === 'error' && 'bg-[var(--text-error)]'
                              )}
                            />
                          ) : null}
                        </div>
                      </div>
                    </button>
                    {/*
                     * The failure explains itself where it happened. A banner under
                     * the list said the same words but sat detached from the step it
                     * belonged to, and the run's other seven steps had to scroll past
                     * it to be read.
                     */}
                    {step.status === 'error' && step.depth === 0 ? (
                      <div className='relative ps-8 pe-3 pb-3'>
                        {/*
                         * An outline, not a filled card. A fill had to be re-tuned for
                         * every surface it could sit on — the row, the selected band,
                         * the hover — and still competed with the failure it contains.
                         * A border needs none of that and lets the row's hover read
                         * straight through. `w-fit` holds it to the width of its own
                         * content instead of stretching to the panel.
                         *
                         * `p-3` matches the panel's own section rhythm rather than the
                         * toast's tighter `p-2`, and the radius follows it: the chips
                         * inside are `rounded-lg`, so 8 + 12 keeps the corners
                         * concentric with them.
                         */}
                        <div className='w-fit rounded-[20px] border border-[var(--border)] p-3'>
                          <p className='font-medium text-[var(--text-primary)] text-small'>
                            {step.detail}
                          </p>
                          <p className='mt-0.5 text-[var(--text-secondary)] text-caption'>
                            Cannot read properties of undefined (reading ‘id’)
                          </p>
                          <div className='mt-2 flex flex-wrap gap-1.5'>
                            <Chip
                              variant='primary'
                              onClick={() =>
                                toast.success('Sent to Chat', {
                                  description: `Sim is looking into ${step.name}.`,
                                })
                              }
                            >
                              Ask Sim to fix
                            </Chip>
                            <Chip variant='border' onClick={onOpenDiagnostics}>
                              Inspect
                            </Chip>
                            <Chip
                              variant='border'
                              onClick={() => toast.success(`Retry queued from ${step.name}`)}
                            >
                              Retry
                            </Chip>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

export function LogsPrototype() {
  const searchParams = useSearchParams()
  /* A deep link to the trace opens the newest run rather than the list. */
  const shouldOpenTrace = searchParams.get('tab') === 'trace'
  const [selectedRun, setSelectedRun] = useState<PrototypeRun | null>(null)

  const snapshot = useWorkflowRunSnapshotStore((state) => state.snapshot)
  const openSnapshot = useWorkflowRunSnapshotStore((state) => state.openSnapshot)
  const selectBlock = useWorkflowRunSnapshotStore((state) => state.selectBlock)
  const openDiagnostics = useWorkflowRunSnapshotStore((state) => state.openDiagnostics)
  const showSnapshot = useWorkflowRunSnapshotStore((state) => state.showSnapshot)
  const showLive = useWorkflowRunSnapshotStore((state) => state.showLive)

  /**
   * The run the canvas is currently showing. Keyed by id so dismissing the
   * snapshot is not immediately undone by the effect that opens it.
   */
  const openedRunIdRef = useRef<string | null>(null)

  /**
   * The canvas belongs to the prototype for as long as the panel is open, so the
   * workflow behind the runs is the one they ran — not whatever the editor last
   * had loaded. Browsing the list leaves it on the current workflow.
   */
  useEffect(() => {
    if (snapshot) return
    openSnapshot({ executionId: '', workflowState: PROTOTYPE_WORKFLOW_STATE, mode: 'live' })
  }, [openSnapshot, snapshot])

  /**
   * Picking a run is what opens its snapshot — there is no separate step for it,
   * because reading a run and seeing it on the canvas are the same intent.
   */
  const openRun = useCallback(
    (run: PrototypeRun) => {
      openedRunIdRef.current = run.id
      setSelectedRun(run)
      const failed = run.status === 'error'
      openSnapshot({
        executionId: run.id,
        workflowState: PROTOTYPE_WORKFLOW_STATE,
        selectedBlockId: failed ? 'findAndres' : null,
        selectedStepId: failed ? 'step-findAndres' : null,
      })
    },
    [openSnapshot]
  )

  const openedTraceRef = useRef(false)
  useEffect(() => {
    if (!shouldOpenTrace || openedTraceRef.current) return
    openedTraceRef.current = true
    openRun(PROTOTYPE_RUNS[0])
  }, [openRun, shouldOpenTrace])

  /**
   * Handing the canvas back to the current workflow ends the visit to that run,
   * so the panel returns to the list rather than sitting on a detail view whose
   * snapshot is no longer on screen. This is what "Back to current" and Escape
   * resolve to.
   */
  useEffect(() => {
    if (!selectedRun || openedRunIdRef.current !== selectedRun.id) return
    if (snapshot && snapshot.mode !== 'live') return
    openedRunIdRef.current = null
    setSelectedRun(null)
  }, [selectedRun, snapshot])

  if (!selectedRun) return <RunsOverview onSelectRun={openRun} />

  return (
    <RunDetail
      run={selectedRun}
      selectedBlockId={snapshot?.selectedBlockId ?? null}
      selectedStepId={snapshot?.selectedStepId ?? null}
      onBack={() => {
        openedRunIdRef.current = null
        showLive()
        setSelectedRun(null)
      }}
      onSelectStep={selectBlock}
      onOpenDiagnostics={() => openDiagnostics('findAndres', 'step-findAndres')}
      inspectorOpen={snapshot?.mode === 'diagnostics'}
      onToggleInspector={() =>
        snapshot?.mode === 'diagnostics'
          ? showSnapshot()
          : openDiagnostics(snapshot?.selectedBlockId ?? 'schedule')
      }
    />
  )
}
