import { Chip, ChipTextarea, cn } from '@sim/emcn'
import { Download } from '@sim/emcn/icons'
import type { BenchmarkRun } from '@/lib/api/contracts/benchmarks'
import { saveBlob } from '@/lib/uploads/client/download'
import { BenchmarkReviewedResults } from '@/app/o/[organizationId]/benchmark/components/benchmark-reviewed-results'

interface BenchmarkRunComparisonProps {
  run: BenchmarkRun
  baseline?: BenchmarkRun
  organizationId: string
}

function RunSnapshot({
  run,
  title,
  organizationId,
}: {
  run: BenchmarkRun
  title: string
  organizationId: string
}) {
  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <h3 className='text-[var(--text-primary)] text-base'>{title}</h3>
          <p className='mt-1 break-words text-[var(--text-body)] text-small'>
            {run.label || new Date(run.createdAt).toLocaleString()}
          </p>
          <p className='mt-1 text-[var(--text-muted)] text-small tabular-nums'>
            {Math.round((run.correct / run.total) * 100)}% · {run.correct} of {run.total} recovered
          </p>
          <p className='mt-1 text-[var(--text-muted)] text-small'>
            {run.artifacts.recoveryMode === 'references'
              ? 'Spec with reference resolution'
              : 'Spec only'}
          </p>
          {run.reviewedCount > 0 && (
            <p className='mt-1 text-[var(--text-muted)] text-small'>
              {run.reviewedCount} human overrides · AI score{' '}
              {Math.round((run.automaticCorrect / run.total) * 100)}%
            </p>
          )}
        </div>
        <Chip
          leftIcon={Download}
          aria-label={`Export ${title.toLowerCase()}`}
          onClick={() =>
            saveBlob(
              new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }),
              `benchmark-run-${run.id}.json`
            )
          }
        />
      </div>
      <details>
        <summary className='cursor-pointer text-[var(--text-body)] text-small'>
          Generated specification
        </summary>
        <div className='mt-3'>
          <ChipTextarea
            aria-label={`${title} specification`}
            value={run.artifacts.generatedSpec}
            viewOnly
            rows={12}
            resizable
          />
        </div>
      </details>
      <details>
        <summary className='cursor-pointer text-[var(--text-body)] text-small'>
          Task and reference
        </summary>
        <div className='mt-3 flex flex-col gap-3'>
          <p className='whitespace-pre-wrap break-words text-[var(--text-body)] text-small'>
            {run.artifacts.taskBrief}
          </p>
          <ChipTextarea
            aria-label={`${title} reference`}
            value={run.artifacts.referenceSpec}
            viewOnly
            rows={10}
            resizable
          />
        </div>
      </details>
      <BenchmarkReviewedResults key={run.id} run={run} organizationId={organizationId} />
    </div>
  )
}

export function BenchmarkRunComparison({
  run,
  baseline,
  organizationId,
}: BenchmarkRunComparisonProps) {
  const comparable = baseline?.evaluationKey === run.evaluationKey
  const delta = baseline ? (run.correct / run.total - baseline.correct / baseline.total) * 100 : 0
  const baselineGrades = new Map(baseline?.artifacts.grade.map((item) => [item.id, item.correct]))
  for (const review of baseline?.reviews ?? []) baselineGrades.set(review.id, review.correct)
  const grades = new Map(run.artifacts.grade.map((item) => [item.id, item.correct]))
  for (const review of run.reviews) grades.set(review.id, review.correct)
  const improved = [...grades].filter(
    ([id, correct]) => correct && baselineGrades.get(id) === false
  ).length
  const regressed = [...grades].filter(
    ([id, correct]) => !correct && baselineGrades.get(id) === true
  ).length

  return (
    <div className='flex flex-col gap-5'>
      {baseline && (
        <p role='status' className='text-[var(--text-body)] text-small'>
          {comparable
            ? `${delta > 0 ? '+' : ''}${Number(delta.toFixed(1))} percentage points vs baseline · ${improved} details improved · ${regressed} regressed`
            : 'These runs used different inputs or recovery methods. Their scores are not directly comparable.'}
        </p>
      )}
      {(run.reviewedCount > 0 || (baseline?.reviewedCount ?? 0) > 0) && (
        <p className='text-[var(--text-muted)] text-small'>
          Scores include human reviews. Original AI scores are shown with each run.
        </p>
      )}
      <div className={cn('grid gap-6', baseline && 'lg:grid-cols-2')}>
        <RunSnapshot run={run} title='Selected run' organizationId={organizationId} />
        {baseline && (
          <RunSnapshot run={baseline} title='Baseline' organizationId={organizationId} />
        )}
      </div>
    </div>
  )
}
