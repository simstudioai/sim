'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipInput, ChipModalError, ChipTextarea } from '@sim/emcn'
import { Download, Trash } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import type {
  BenchmarkCase,
  RunBenchmarkStageBody,
  UpdateBenchmarkBody,
} from '@/lib/api/contracts/benchmarks'
import { saveBlob } from '@/lib/uploads/client/download'
import { BenchmarkHistory } from '@/app/o/[organizationId]/benchmark/components/benchmark-history'
import { BenchmarkReference } from '@/app/o/[organizationId]/benchmark/components/benchmark-reference'
import { BenchmarkResults } from '@/app/o/[organizationId]/benchmark/components/benchmark-results'
import { BenchmarkStep } from '@/app/o/[organizationId]/benchmark/components/benchmark-step'
import {
  benchmarkParams,
  benchmarkUrlOptions,
} from '@/app/o/[organizationId]/benchmark/search-params'
import {
  useBenchmark,
  useBenchmarkWorkspaces,
  useDeleteBenchmark,
  useRunBenchmarkStage,
  useUpdateBenchmark,
} from '@/hooks/queries/benchmarks'

interface BenchmarkDetailProps {
  organizationId: string
  benchmarkId: string
  canPlan: boolean
  runAsUserId: string
  onDeleted: () => void
}

interface BenchmarkEditorProps {
  benchmark: BenchmarkCase
  canPlan: boolean
  busy: boolean
  saving: boolean
  stage: RunBenchmarkStageBody['stage'] | null
  onUpdate: (body: UpdateBenchmarkBody) => void
  onRun: (stage: RunBenchmarkStageBody['stage'], runLabel?: string) => void
}

function BenchmarkEditor({
  benchmark,
  canPlan,
  busy,
  saving,
  stage,
  onUpdate,
  onRun,
}: BenchmarkEditorProps) {
  const [draft, setDraft] = useState(benchmark.artifacts)
  const [runLabel, setRunLabel] = useState('')
  const { artifacts } = benchmark
  const referenceDirty =
    draft.taskBrief !== artifacts.taskBrief || draft.referenceSpec !== artifacts.referenceSpec
  const redactionDirty =
    draft.redactedSpec !== artifacts.redactedSpec ||
    draft.blanks.length !== artifacts.blanks.length ||
    draft.blanks.some(
      (blank, index) =>
        blank.id !== artifacts.blanks[index]?.id || blank.answer !== artifacts.blanks[index]?.answer
    )
  const dirty = referenceDirty || redactionDirty
  const hasPlannerInputs =
    artifacts.taskBrief.trim() &&
    artifacts.referenceSpec.trim() &&
    artifacts.blanks.length > 0 &&
    artifacts.redactedSpec.trim()
  const correct = artifacts.grade?.filter((result) => result.correct).length ?? 0
  const total = artifacts.blanks.length

  return (
    <div className='flex flex-col gap-8 divide-y divide-[var(--border)] [&>section+section]:pt-8'>
      <BenchmarkReference
        artifacts={draft}
        busy={busy}
        saving={saving}
        stage={stage}
        referenceDirty={referenceDirty}
        redactionDirty={redactionDirty}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        onSave={() => {
          onUpdate(
            referenceDirty
              ? {
                  version: benchmark.version,
                  ...(draft.taskBrief !== artifacts.taskBrief
                    ? { taskBrief: draft.taskBrief }
                    : {}),
                  ...(draft.referenceSpec !== artifacts.referenceSpec
                    ? { referenceSpec: draft.referenceSpec }
                    : {}),
                }
              : {
                  version: benchmark.version,
                  redactedSpec: draft.redactedSpec,
                  blanks: draft.blanks,
                }
          )
        }}
        onRun={onRun}
      />
      <BenchmarkStep
        number={2}
        title='Build the new plan'
        description='Run the benchmark Mothership in Plan mode with the task brief and the selected user’s enterprise context.'
        pending={stage === 'plan'}
        action={
          <Chip
            variant='primary'
            disabled={busy || dirty || !canPlan || !hasPlannerInputs}
            onClick={() => onRun('plan')}
          >
            {stage === 'plan' ? 'Planning…' : artifacts.generatedSpec ? 'Run again' : 'Run planner'}
          </Chip>
        }
      >
        {!canPlan && (
          <p className='text-[var(--text-muted)] text-small'>
            Plan mode requires permission to create organization workspaces. An organization
            administrator can update the selected user’s access.
          </p>
        )}
        {artifacts.generatedSpec ? (
          <ChipTextarea
            aria-label='Generated plan'
            value={artifacts.generatedSpec}
            viewOnly
            rows={14}
            resizable
          />
        ) : (
          <p className='text-[var(--text-muted)] text-small'>
            Review and save the reference and blanks before running the planner.
          </p>
        )}
      </BenchmarkStep>
      <BenchmarkStep
        number={3}
        title='Fill in the blanks'
        description='A fresh reader fills the blanks by reading or searching the generated plan. It has no enterprise access or prior memory.'
        pending={stage === 'reconstruct'}
        action={
          <Chip
            disabled={busy || dirty || !artifacts.generatedSpec}
            onClick={() => onRun('reconstruct')}
          >
            {stage === 'reconstruct' ? 'Reconstructing…' : 'Reconstruct'}
          </Chip>
        }
      >
        {artifacts.reconstruction && <BenchmarkResults artifacts={artifacts} />}
      </BenchmarkStep>
      <BenchmarkStep
        number={4}
        title='Grade the result'
        description='Check each recovered answer and save the result to run history.'
        pending={stage === 'grade'}
        action={
          <Chip
            disabled={busy || dirty || !artifacts.reconstruction}
            onClick={() => onRun('grade', runLabel)}
          >
            {stage === 'grade' ? 'Grading…' : 'Grade'}
          </Chip>
        }
      >
        <div className='flex flex-col gap-2'>
          <label htmlFor='benchmark-run-label' className='text-[var(--text-body)] text-small'>
            Run label (optional)
          </label>
          <ChipInput
            id='benchmark-run-label'
            value={runLabel}
            maxLength={100}
            onChange={(event) => setRunLabel(event.target.value)}
            placeholder='e.g. Baseline or updated discovery'
            disabled={busy}
          />
        </div>
        {artifacts.grade && (
          <>
            <p className='text-[var(--text-primary)] text-base'>
              <span className='tabular-nums'>
                {total ? Math.round((correct / total) * 100) : 0}%
              </span>
              <span className='ml-2 text-[var(--text-muted)] text-small'>
                {correct} of {total} required details recovered
              </span>
            </p>
            <BenchmarkResults artifacts={artifacts} showGrade />
          </>
        )}
      </BenchmarkStep>
    </div>
  )
}

export function BenchmarkDetail({
  organizationId,
  benchmarkId,
  canPlan,
  runAsUserId,
  onDeleted,
}: BenchmarkDetailProps) {
  const [{ benchmarkView }, setParams] = useQueryStates(benchmarkParams, benchmarkUrlOptions)
  const benchmarkQuery = useBenchmark(organizationId, benchmarkId)
  const updateBenchmark = useUpdateBenchmark(organizationId, benchmarkId)
  const runStage = useRunBenchmarkStage(organizationId, benchmarkId)
  const deleteBenchmark = useDeleteBenchmark(organizationId, benchmarkId)
  const workspaces = useBenchmarkWorkspaces(organizationId, runAsUserId)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const benchmark = benchmarkQuery.data?.benchmark

  if (!benchmark) {
    return (
      <p
        role={benchmarkQuery.error ? 'alert' : 'status'}
        className='text-[var(--text-muted)] text-small'
      >
        {benchmarkQuery.error?.message ?? 'Loading benchmark…'}
      </p>
    )
  }

  if ((benchmark.runAsUserId ?? benchmark.userId) !== runAsUserId)
    return (
      <p role='alert' className='text-[var(--text-error)] text-small'>
        This benchmark belongs to a different execution user. Select a saved benchmark for the
        current user.
      </p>
    )

  const activeLease =
    benchmark.runningStage !== null &&
    benchmark.leaseExpiresAt !== null &&
    Date.parse(benchmark.leaseExpiresAt) > Date.now()
  const busy =
    activeLease || runStage.isPending || updateBenchmark.isPending || deleteBenchmark.isPending
  const stage = runStage.isPending
    ? runStage.variables.stage
    : activeLease
      ? benchmark.runningStage
      : null
  const error = runStage.error?.message ?? updateBenchmark.error?.message ?? benchmark.error

  return (
    <div aria-busy={benchmarkQuery.isFetching} className='flex flex-col gap-6'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='min-w-0'>
          <h2 className='break-words text-[var(--text-primary)] text-base'>{benchmark.name}</h2>
          <p className='mt-1 break-words text-[var(--text-muted)] text-small'>
            Source:{' '}
            {workspaces.data?.pages
              .flatMap((page) => page.workspaces)
              .find((workspace) => workspace.id === benchmark.sourceWorkspaceId)?.name ??
              benchmark.sourceWorkspaceId}
          </p>
        </div>
        <div className='flex items-center gap-1'>
          <Chip
            leftIcon={Download}
            onClick={() =>
              saveBlob(
                new Blob([JSON.stringify(benchmark, null, 2)], { type: 'application/json' }),
                `benchmark-${benchmark.id}.json`
              )
            }
          >
            Export
          </Chip>
          <Chip
            leftIcon={Trash}
            aria-label='Delete benchmark'
            disabled={busy}
            onClick={() => setDeleteOpen(true)}
          />
        </div>
      </div>
      {error && (
        <p role='alert' className='text-[var(--text-error)] text-small'>
          {error}
        </p>
      )}
      {benchmark.runningStage && !activeLease && !runStage.isPending && (
        <p role='status' className='text-[var(--text-muted)] text-small'>
          The previous attempt expired. You can run that step again.
        </p>
      )}
      <div className='flex gap-1' aria-label='Benchmark views'>
        <Chip
          variant={benchmarkView === 'current' ? 'primary' : undefined}
          onClick={() => setParams({ benchmarkView: 'current' })}
        >
          Current run
        </Chip>
        <Chip
          variant={benchmarkView === 'history' ? 'primary' : undefined}
          onClick={() => setParams({ benchmarkView: 'history' })}
        >
          Run history
        </Chip>
      </div>
      {benchmarkView === 'history' ? (
        <BenchmarkHistory organizationId={organizationId} benchmarkId={benchmarkId} />
      ) : (
        <BenchmarkEditor
          key={`${benchmark.id}:${benchmark.version}`}
          benchmark={benchmark}
          canPlan={canPlan}
          busy={busy}
          saving={updateBenchmark.isPending}
          stage={stage}
          onUpdate={(body) => {
            runStage.reset()
            updateBenchmark.mutate(body)
          }}
          onRun={(nextStage, runLabel) => {
            updateBenchmark.reset()
            runStage.mutate(
              { version: benchmark.version, stage: nextStage, runLabel },
              {
                onSuccess: () => {
                  if (nextStage === 'grade')
                    setParams({
                      benchmarkView: 'history',
                      runId: null,
                      compareRunId: null,
                      runsCursor: null,
                    })
                },
              }
            )
          }}
        />
      )}
      <ChipConfirmModal
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deleteBenchmark.isPending) setDeleteOpen(open)
        }}
        title='Delete benchmark'
        text={`Delete “${benchmark.name}” and its saved results? The source workspace is unaffected.`}
        confirm={{
          label: 'Delete',
          pendingLabel: 'Deleting…',
          pending: deleteBenchmark.isPending,
          disabled: deleteBenchmark.isPending,
          onClick: () =>
            deleteBenchmark.mutate({ version: benchmark.version }, { onSuccess: onDeleted }),
        }}
      >
        <ChipModalError>{deleteBenchmark.error?.message}</ChipModalError>
      </ChipConfirmModal>
    </div>
  )
}
