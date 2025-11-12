export interface AggregateMetrics {
  totalExecutions: number
  successfulExecutions: number
  failedExecutions: number
  activeWorkflows: number
  successRate: number
}

export function KPIs({ aggregate }: { aggregate: AggregateMetrics }) {
  return (
    <div className='mb-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4'>
      <div className='border bg-card p-4 shadow-sm'>
        <div className='text-muted-foreground text-xs'>Total executions</div>
        <div className='mt-1 font-[440] text-[22px] leading-6'>
          {aggregate.totalExecutions.toLocaleString()}
        </div>
      </div>
      <div className='border bg-card p-4 shadow-sm'>
        <div className='text-muted-foreground text-xs'>Success rate</div>
        <div className='mt-1 font-[440] text-[22px] leading-6'>
          {aggregate.successRate.toFixed(1)}%
        </div>
      </div>
      <div className='border bg-card p-4 shadow-sm'>
        <div className='text-muted-foreground text-xs'>Failed executions</div>
        <div className='mt-1 font-[440] text-[22px] leading-6'>
          {aggregate.failedExecutions.toLocaleString()}
        </div>
      </div>
      <div className='border bg-card p-4 shadow-sm'>
        <div className='text-muted-foreground text-xs'>Active workflows</div>
        <div className='mt-1 font-[440] text-[22px] leading-6'>{aggregate.activeWorkflows}</div>
      </div>
    </div>
  )
}

export default KPIs
