'use client'

import { Chip } from '@sim/emcn'
import { useQueryStates } from 'nuqs'
import { BenchmarkRunComparison } from '@/app/o/[organizationId]/benchmark/components/benchmark-run-comparison'
import {
  benchmarkParams,
  benchmarkUrlOptions,
} from '@/app/o/[organizationId]/benchmark/search-params'
import { useBenchmarkRun, useBenchmarkRuns } from '@/hooks/queries/benchmarks'

interface BenchmarkHistoryProps {
  organizationId: string
  benchmarkId: string
}

export function BenchmarkHistory({ organizationId, benchmarkId }: BenchmarkHistoryProps) {
  const [{ runId, compareRunId, runsCursor }, setParams] = useQueryStates(
    benchmarkParams,
    benchmarkUrlOptions
  )
  const history = useBenchmarkRuns(organizationId, benchmarkId, runsCursor)
  const runs = history.data?.runs ?? []
  const selectedId = runId || runs[0]?.id || ''
  const selected = useBenchmarkRun(organizationId, benchmarkId, selectedId)
  const baselineId = compareRunId === selectedId ? '' : compareRunId
  const baseline = useBenchmarkRun(organizationId, benchmarkId, baselineId)
  const error = history.error?.message ?? selected.error?.message ?? baseline.error?.message

  return (
    <section className='flex flex-col gap-5'>
      <div>
        <h2 className='text-[var(--text-primary)] text-base'>Run history</h2>
        <p className='mt-1 text-[var(--text-muted)] text-small'>
          Every completed grade is saved. View a run, then choose another as its baseline.
        </p>
      </div>
      {error && (
        <p role='alert' className='text-[var(--text-error)] text-small'>
          {error}
        </p>
      )}
      {history.isPending ? (
        <p role='status' className='text-[var(--text-muted)] text-small'>
          Loading runs…
        </p>
      ) : runs.length === 0 && !history.error ? (
        <p className='text-[var(--text-muted)] text-small'>
          No saved runs yet. Complete the Grade step to save your first result.
        </p>
      ) : (
        <div className='overflow-x-auto rounded-lg border border-[var(--border)]'>
          <table className='w-full text-left text-small'>
            <thead className='border-[var(--border)] border-b text-[var(--text-muted)]'>
              <tr>
                <th className='px-4 py-3 font-normal'>Run</th>
                <th className='px-4 py-3 font-normal'>Score</th>
                <th className='px-4 py-3 font-normal'>
                  <span className='sr-only'>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-[var(--border)]'>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td className='px-4 py-3 text-[var(--text-body)]'>
                    {run.label && <p className='break-words'>{run.label}</p>}
                    <p className='text-[var(--text-muted)]'>
                      {new Date(run.createdAt).toLocaleString()}
                    </p>
                  </td>
                  <td className='whitespace-nowrap px-4 py-3 text-[var(--text-body)] tabular-nums'>
                    {Math.round((run.correct / run.total) * 100)}%{' '}
                    <span className='text-[var(--text-muted)]'>
                      ({run.correct}/{run.total})
                    </span>
                    {run.reviewedCount > 0 && (
                      <p className='mt-1 text-[var(--text-muted)]'>
                        Human reviewed · AI {Math.round((run.automaticCorrect / run.total) * 100)}%
                      </p>
                    )}
                  </td>
                  <td className='px-4 py-3'>
                    <div className='flex justify-end gap-1'>
                      <Chip
                        variant={selectedId === run.id ? 'primary' : undefined}
                        onClick={() =>
                          setParams({
                            runId: run.id,
                            ...(baselineId === run.id ? { compareRunId: null } : {}),
                          })
                        }
                      >
                        {selectedId === run.id ? 'Viewing' : 'View'}
                      </Chip>
                      <Chip
                        disabled={selectedId === run.id}
                        variant={baselineId === run.id ? 'primary' : undefined}
                        onClick={() => setParams({ compareRunId: run.id })}
                      >
                        {baselineId === run.id ? 'Baseline' : 'Compare'}
                      </Chip>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className='flex gap-1'>
        {runsCursor && (
          <Chip onClick={() => setParams({ runsCursor: null, runId: selectedId })}>
            Newest runs
          </Chip>
        )}
        {history.data?.nextCursor && (
          <Chip
            disabled={history.isFetching}
            onClick={() => setParams({ runsCursor: history.data?.nextCursor, runId: selectedId })}
          >
            Older runs
          </Chip>
        )}
      </div>
      {baselineId && (
        <Chip className='self-start' onClick={() => setParams({ compareRunId: null })}>
          Clear comparison
        </Chip>
      )}
      {selectedId && (selected.isPending || (baselineId && baseline.isPending)) && (
        <p role='status' className='text-[var(--text-muted)] text-small'>
          Loading saved results…
        </p>
      )}
      {selected.data && (
        <BenchmarkRunComparison
          run={selected.data.run}
          baseline={baseline.error ? undefined : baseline.data?.run}
          organizationId={organizationId}
        />
      )}
    </section>
  )
}
