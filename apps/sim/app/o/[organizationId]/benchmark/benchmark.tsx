'use client'

import { Chip } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { emptyBenchmarkSelection } from '@/app/benchmark/search-params'
import { BenchmarkDetail, CreateBenchmark } from '@/app/o/[organizationId]/benchmark/components'
import {
  benchmarkParams,
  benchmarkUrlOptions,
} from '@/app/o/[organizationId]/benchmark/search-params'
import { useBenchmarks } from '@/hooks/queries/benchmarks'

interface BenchmarkProps {
  organizationId: string
  canPlan: boolean
  runAsUserId: string
}

export function Benchmark({ organizationId, canPlan, runAsUserId }: BenchmarkProps) {
  const [{ benchmarkId, creating }, setParams] = useQueryStates(
    benchmarkParams,
    benchmarkUrlOptions
  )
  const benchmarks = useBenchmarks(organizationId, runAsUserId)
  const records = benchmarks.data?.pages.flatMap((page) => page.benchmarks) ?? []

  return (
    <div className='mx-auto flex w-full max-w-chat flex-col gap-5 px-6 pt-7 pb-12'>
      <div className='flex items-center justify-between gap-3'>
        <h2 className='text-[var(--text-primary)] text-base'>
          {creating ? 'New benchmark' : benchmarkId ? 'Benchmark' : 'Saved benchmarks'}
        </h2>
        {creating ? (
          <Chip onClick={() => setParams(emptyBenchmarkSelection)}>Cancel</Chip>
        ) : (
          <div className='flex items-center gap-2'>
            {benchmarkId && (
              <Chip onClick={() => setParams(emptyBenchmarkSelection)}>All benchmarks</Chip>
            )}
            <Chip
              variant='primary'
              leftIcon={Plus}
              onClick={() => setParams({ ...emptyBenchmarkSelection, creating: true })}
            >
              New benchmark
            </Chip>
          </div>
        )}
      </div>
      {creating ? (
        <CreateBenchmark
          organizationId={organizationId}
          runAsUserId={runAsUserId}
          onCreated={(value) => setParams({ ...emptyBenchmarkSelection, benchmarkId: value })}
        />
      ) : benchmarkId ? (
        <BenchmarkDetail
          key={benchmarkId}
          organizationId={organizationId}
          benchmarkId={benchmarkId}
          runAsUserId={runAsUserId}
          canPlan={canPlan}
          onDeleted={() => setParams(emptyBenchmarkSelection, { history: 'replace' })}
        />
      ) : (
        <>
          {benchmarks.error ? (
            <p role='alert' className='text-[var(--text-error)] text-small'>
              {benchmarks.error.message}
            </p>
          ) : benchmarks.isLoading ? (
            <p role='status' className='text-[var(--text-muted)] text-small'>
              Loading benchmarks…
            </p>
          ) : records.length === 0 ? (
            <div className='rounded-lg border border-[var(--border)] p-5'>
              <p className='text-[var(--text-primary)] text-small'>No benchmarks yet</p>
              <p className='mt-1 text-[var(--text-muted)] text-small'>
                Create a benchmark from a workspace to generate a reference, run the planner, and
                compare results.
              </p>
            </div>
          ) : (
            <div className='divide-y divide-[var(--border)]'>
              {records.map((record) => (
                <div key={record.id} className='flex items-center justify-between gap-4 py-3'>
                  <div className='min-w-0'>
                    <p className='break-words text-small'>{record.name}</p>
                    <p className='mt-1 text-[var(--text-muted)] text-small'>
                      Updated {new Date(record.updatedAt).toLocaleString()}
                      {record.runningStage ? ` · ${record.runningStage} in progress` : ''}
                    </p>
                  </div>
                  <Chip
                    onClick={() =>
                      setParams({ ...emptyBenchmarkSelection, benchmarkId: record.id })
                    }
                  >
                    Open
                  </Chip>
                </div>
              ))}
            </div>
          )}
          {benchmarks.hasNextPage && (
            <div>
              <Chip
                disabled={benchmarks.isFetchingNextPage}
                onClick={() => benchmarks.fetchNextPage()}
              >
                {benchmarks.isFetchingNextPage ? 'Loading…' : 'Load older benchmarks'}
              </Chip>
            </div>
          )}
        </>
      )}
    </div>
  )
}
