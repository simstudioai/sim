'use client'

import { Chip, Code, cn, useCopyToClipboard } from '@sim/emcn'
import { Check, Clipboard, X } from '@sim/emcn/icons'
import { StepIcon } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/logs/logs-prototype'
import {
  formatMs,
  PROTOTYPE_RUN_STEPS,
  PROTOTYPE_WORKFLOW_STATE,
  type PrototypeRunStep,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/logs/prototype-data'
import { RunStatusBadge } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/logs/run-status'
import { useWorkflowRunSnapshotStore } from '@/stores/logs/workflow-run-snapshot'

type InspectableStep = PrototypeRunStep & { index: number; offsetMs: number }

function collectSteps(step: PrototypeRunStep, index: number, offsetMs: number): InspectableStep[] {
  const nested: InspectableStep[] = []
  let childOffset = offsetMs

  for (const child of step.children ?? []) {
    nested.push(...collectSteps(child, index, childOffset))
    childOffset += child.typicalMs
  }

  return [{ ...step, index, offsetMs }, ...nested]
}

/** Flattened once so nested spans — a model turn, a tool call — are inspectable too. */
const INSPECTABLE_STEPS = PROTOTYPE_RUN_STEPS.flatMap((step, index) =>
  collectSteps(step, index, step.startMs)
)

/** The fixture's runs all start at 5:00 PM, the digest's scheduled hour. */
const RUN_START_HOUR = 17

/**
 * Edge fade for the stats line. An agent span carries enough numbers to overrun
 * a narrow drawer; a value dissolving into the gutter says to scroll, where a
 * hard cut just looks broken.
 */
const STATS_FADE =
  'linear-gradient(to right, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)'

function formatStepClock(offsetMs: number): string {
  const clock = new Date(0)
  clock.setUTCHours(RUN_START_HOUR, 0, 0, 0)
  clock.setUTCMilliseconds(offsetMs)
  const hours = clock.getUTCHours()
  const minutes = String(clock.getUTCMinutes()).padStart(2, '0')
  const seconds = String(clock.getUTCSeconds()).padStart(2, '0')
  const millis = String(clock.getUTCMilliseconds()).padStart(3, '0')
  return `${hours % 12 || 12}:${minutes}:${seconds}.${millis} ${hours < 12 ? 'AM' : 'PM'}`
}

/** One captured value: its name, a copy control, and the JSON itself. */
function ValuePane({ label, data, isError }: { label: string; data: string; isError?: boolean }) {
  const { copied, copy } = useCopyToClipboard({ resetMs: 1500 })

  return (
    <section className='flex min-w-0 flex-none flex-col gap-1.5'>
      <div className='flex items-center justify-between gap-2'>
        <span
          className={cn(
            'text-caption',
            isError ? 'text-[var(--text-error)]' : 'text-[var(--text-muted)]'
          )}
        >
          {label}
        </span>
        <Chip
          size='sm'
          leftIcon={copied ? Check : Clipboard}
          aria-label={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
          onClick={() => copy(data)}
          className='size-[20px] flex-none justify-center p-0'
        />
      </div>
      <Code.Viewer
        code={data}
        language='json'
        wrapText
        className='!bg-[var(--surface-4)] dark:!bg-[var(--surface-3)] max-w-full rounded-md border-0 [word-break:break-all]'
      />
    </section>
  )
}

/**
 * What the run recorded for the selected step: the span's own stats across the
 * top, then the two values it captured side by side.
 *
 * A span has an input and an output. It does not have the block's source, and it
 * does not have a console — so neither appears here. Anything beyond input and
 * output is optional and shows only where the runtime captured it.
 */
export function DiagnosticsWorkspace() {
  const selectedBlockId = useWorkflowRunSnapshotStore((state) => state.snapshot?.selectedBlockId)
  const selectedStepId = useWorkflowRunSnapshotStore((state) => state.snapshot?.selectedStepId)
  const closeSnapshot = useWorkflowRunSnapshotStore((state) => state.closeSnapshot)

  /*
   * The inspector reads the selection rather than owning one — the execution list
   * drives it. There is always a step, so there is always something to show.
   */
  const step =
    INSPECTABLE_STEPS.find((entry) => entry.id === selectedStepId) ??
    INSPECTABLE_STEPS.find((entry) => entry.blockId === selectedBlockId)
  const blockType = selectedBlockId
    ? PROTOTYPE_WORKFLOW_STATE.blocks[selectedBlockId]?.type
    : undefined

  const inspector = step?.inspector

  /* Built in the trace view's own order, so the two surfaces read alike. */
  const stats: Array<{ label: string; value: string }> = []
  if (step) {
    stats.push({ label: 'Started', value: formatStepClock(step.offsetMs) })
    stats.push({ label: 'Duration', value: formatMs(step.typicalMs) })
    stats.push({ label: 'Tries', value: String(inspector?.tries ?? 1) })
    if (inspector?.model) stats.push({ label: 'Model', value: inspector.model })
    if (inspector?.tokens) {
      stats.push({ label: 'Input tokens', value: inspector.tokens.input.toLocaleString() })
      stats.push({ label: 'Output tokens', value: inspector.tokens.output.toLocaleString() })
      stats.push({ label: 'Total tokens', value: inspector.tokens.total.toLocaleString() })
    }
    if (inspector?.errorType) stats.push({ label: 'Error type', value: inspector.errorType })
    if (inspector?.iterationIndex !== undefined) {
      stats.push({ label: 'Iteration', value: String(inspector.iterationIndex + 1) })
    }
  }

  return (
    <div className='flex h-full min-h-0 flex-col bg-[var(--bg)]'>
      <header className='flex h-10 flex-none items-center gap-2 border-[var(--border)] border-b px-3'>
        <StepIcon blockType={blockType} />
        <span className='min-w-0 flex-1 truncate font-medium text-[var(--text-primary)] text-small'>
          {step?.name ?? 'Inspector'}
        </span>
        {step ? <RunStatusBadge status={step.status} /> : null}
        <Chip
          leftIcon={X}
          size='sm'
          onClick={closeSnapshot}
          aria-label='Close inspector'
          className='size-[22px] flex-none justify-center p-0'
        />
      </header>

      {/*
       * The span's numbers open the content rather than sitting in a strip of
       * their own: a label over its value, left-aligned, the pairs in a row.
       * Living inside the content means they cost no divider — the header's rule
       * is the only one above the panes.
       */}
      {stats.length > 0 ? (
        <dl
          style={{ maskImage: STATS_FADE, WebkitMaskImage: STATS_FADE }}
          className='flex flex-none items-start gap-x-6 overflow-x-auto px-3 pt-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        >
          {stats.map((stat) => (
            <div key={stat.label} className='flex flex-none flex-col gap-0.5 text-caption'>
              <dt className='text-[var(--text-muted)]'>{stat.label}</dt>
              <dd className='text-[var(--text-secondary)] tabular-nums'>{stat.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {inspector ? (
        <div className='flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-1 pb-3'>
          <ValuePane label='Input' data={inspector.input} />
          <ValuePane label='Output' data={inspector.output} />
          {inspector.errorMessage ? (
            <ValuePane label='Error message' data={inspector.errorMessage} isError />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
