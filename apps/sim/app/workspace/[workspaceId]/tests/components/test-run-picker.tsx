'use client'

import {
  Badge,
  Chip,
  ChipChevronDown,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemLabel,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Check } from '@sim/emcn/icons'
import { formatRelativeTime } from '@sim/utils/formatting'
import type { WorkflowTestDetail } from '@/lib/api/contracts/workflow-tests'
import { testRunSelectionKey, useTestRunSelectionStore } from '@/stores/workflow-tests/store'

type Run = WorkflowTestDetail['history'][number]

interface TestRunPickerProps {
  workspaceId: string
  name: string
  detail: WorkflowTestDetail
}

/** Chooses which run the test's results show; the latest unless another is picked. */
export function TestRunPicker({ workspaceId, name, detail }: TestRunPickerProps) {
  const key = testRunSelectionKey(workspaceId, name)
  const selectedRunId = useTestRunSelectionStore((state) => state.selectedRunIds[key])
  const selectRun = useTestRunSelectionStore((state) => state.selectRun)
  const runs = detail.history
  const latestId = detail.latestRun?.id
  const shownId = detail.latestRun?.status === 'running' ? latestId : (selectedRunId ?? latestId)
  const shown = runs.find((run) => run.id === shownId)
  if (!shown) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip leftAdornment={<RunDot run={shown} />} rightAdornment={<ChipChevronDown />}>
          {runLabel(shown, shown.id === latestId)}
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='min-w-[260px]'>
        {runs.map((run) => (
          <DropdownMenuItem
            key={run.id}
            onSelect={() => selectRun(key, run.id === latestId ? null : run.id)}
          >
            <RunDot run={run} />
            <DropdownMenuItemLabel label={runLabel(run, run.id === latestId)} />
            <span className='ml-auto flex shrink-0 items-center gap-1.5'>
              <span className='text-[var(--text-muted)] text-caption'>{runResult(run)}</span>
              {run.version === 'draft' && (
                <Badge variant='gray-secondary' size='sm'>
                  Draft
                </Badge>
              )}
              {!run.current && (
                <Badge variant='amber' size='sm'>
                  Out of date
                </Badge>
              )}
            </span>
            {run.id === shownId && (
              <Check className='size-[14px] shrink-0 text-[var(--text-icon)]' />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function runLabel(run: Run, latest: boolean): string {
  const when = formatRelativeTime(run.completedAt ?? run.startedAt)
  return latest ? `Latest · ${when}` : when
}

function runResult(run: Run): string {
  if (run.status === 'passed' || run.status === 'failed') {
    return `${run.passed}/${run.passed + run.failed}`
  }
  return run.status === 'error' ? 'Didn’t finish' : 'Running'
}

const RUN_DOT: Record<Run['status'], string> = {
  passed: 'bg-[var(--badge-success-text)]',
  running: 'bg-[var(--badge-amber-text)]',
  failed: 'bg-[var(--badge-error-text)]',
  error: 'bg-[var(--badge-error-text)]',
}

interface RunDotProps {
  run: Run
}

function RunDot({ run }: RunDotProps) {
  return (
    <span aria-hidden className={cn('size-[6px] shrink-0 rounded-full', RUN_DOT[run.status])} />
  )
}
