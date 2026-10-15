import { HEADER_ACTION_CLUSTER, PAGE_HEADER_BAR } from '@/components/page-header-bar'

export default function BenchmarkLoading() {
  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className={PAGE_HEADER_BAR}>
        <div className={HEADER_ACTION_CLUSTER} />
      </div>
      <div className='mx-auto w-full max-w-chat px-6 pt-8'>
        <h1 className='text-[var(--text-primary)] text-lg'>Benchmark</h1>
        <p role='status' className='mt-4 text-[var(--text-muted)] text-small'>
          Loading benchmarks…
        </p>
      </div>
    </div>
  )
}
