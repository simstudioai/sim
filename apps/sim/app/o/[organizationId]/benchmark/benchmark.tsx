'use client'

import { Chip, ChipCombobox } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { HEADER_ACTION_CLUSTER, PAGE_HEADER_BAR } from '@/components/page-header-bar'
import { BenchmarkDetail, CreateBenchmark } from '@/app/o/[organizationId]/benchmark/components'
import {
  benchmarkParams,
  benchmarkUrlOptions,
} from '@/app/o/[organizationId]/benchmark/search-params'
import { useBenchmarks } from '@/hooks/queries/benchmarks'

interface BenchmarkProps {
  organizationId: string
  canPlan: boolean
}

export function Benchmark({ organizationId, canPlan }: BenchmarkProps) {
  const [{ benchmarkId }, setParams] = useQueryStates(benchmarkParams, benchmarkUrlOptions)
  const benchmarks = useBenchmarks(organizationId)
  const records = benchmarks.data?.pages.flatMap((page) => page.benchmarks) ?? []

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className={PAGE_HEADER_BAR}>
        <div className={HEADER_ACTION_CLUSTER} />
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex w-full max-w-chat flex-col gap-7 px-6 pt-8 pb-12'>
          <div>
            <h1 className='text-[var(--text-primary)] text-lg'>Benchmark</h1>
            <p className='mt-1 text-[var(--text-muted)] text-small'>
              Measure how well a plan captures the details needed to build a workspace.
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <ChipCombobox
              aria-label='Saved benchmarks'
              className='min-w-[200px] flex-1'
              value={benchmarkId}
              options={records.map((record) => ({ value: record.id, label: record.name }))}
              onChange={(value) =>
                setParams({
                  benchmarkId: value,
                  benchmarkView: null,
                  runId: null,
                  compareRunId: null,
                  runsCursor: null,
                })
              }
              placeholder='Saved benchmarks'
              searchable
              isLoading={benchmarks.isLoading}
              error={benchmarks.error?.message}
            />
            <Chip
              leftIcon={Plus}
              onClick={() =>
                setParams({
                  benchmarkId: null,
                  benchmarkView: null,
                  runId: null,
                  compareRunId: null,
                  runsCursor: null,
                })
              }
            >
              New benchmark
            </Chip>
            {benchmarks.hasNextPage && (
              <Chip
                disabled={benchmarks.isFetchingNextPage}
                onClick={() => benchmarks.fetchNextPage()}
              >
                {benchmarks.isFetchingNextPage ? 'Loading…' : 'Load older'}
              </Chip>
            )}
          </div>
          {benchmarkId ? (
            <BenchmarkDetail
              key={benchmarkId}
              organizationId={organizationId}
              benchmarkId={benchmarkId}
              canPlan={canPlan}
              onDeleted={() =>
                setParams(
                  {
                    benchmarkId: null,
                    benchmarkView: null,
                    runId: null,
                    compareRunId: null,
                    runsCursor: null,
                  },
                  { history: 'replace' }
                )
              }
            />
          ) : (
            <CreateBenchmark
              organizationId={organizationId}
              onCreated={(value) => setParams({ benchmarkId: value })}
            />
          )}
        </div>
      </div>
    </div>
  )
}
