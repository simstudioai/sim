import { Chip } from '@sim/emcn'
import type { z } from 'zod'
import { benchmarkModelLabel } from '@/lib/benchmarks/models'
import type { benchmarkRunSummarySchema } from '@/lib/benchmarks/types'

interface BenchmarkScoreChartProps {
  runs: z.infer<typeof benchmarkRunSummarySchema>[]
  selectedId: string
  evaluationKey?: string
  onSelect: (runId: string) => void
}

export function BenchmarkScoreChart({
  runs,
  selectedId,
  evaluationKey,
  onSelect,
}: BenchmarkScoreChartProps) {
  const comparable = runs.filter((run) => run.evaluationKey === evaluationKey)
  if (!comparable.length) return null
  return (
    <div className='flex flex-col gap-4 rounded-lg border border-[var(--border)] p-4'>
      <div>
        <h3 className='text-[var(--text-primary)] text-base'>Model comparison</h3>
        <p className='mt-1 text-[var(--text-muted)] text-small'>
          Runs on this page with the same inputs and evaluator as the selected run. Scores include
          human reviews.
        </p>
      </div>
      <div className='grid gap-4'>
        {comparable.map((run) => {
          const percent = Math.round((run.correct / run.total) * 100)
          return (
            <div
              key={run.id}
              className='grid items-center gap-2 sm:grid-cols-[minmax(180px,1fr)_2fr_auto]'
            >
              <div className='min-w-0'>
                <Chip
                  variant={run.id === selectedId ? 'primary' : undefined}
                  onClick={() => onSelect(run.id)}
                >
                  {benchmarkModelLabel(run.modelRuns.plan?.config)}
                </Chip>
                <p className='mt-1 truncate text-[var(--text-muted)] text-small'>
                  {run.label || new Date(run.createdAt).toLocaleString()}
                </p>
              </div>
              <div
                className='h-3 overflow-hidden rounded-full bg-[var(--surface-3)]'
                role='meter'
                aria-label={`${benchmarkModelLabel(run.modelRuns.plan?.config)} score`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div
                  className='h-full rounded-full bg-[var(--text-primary)]'
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className='text-[var(--text-body)] text-small tabular-nums'>
                {percent}% · {run.correct}/{run.total}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
