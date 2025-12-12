'use client'

interface CostBreakdownProps {
  copilotCost: number
  totalCost: number
}

export function CostBreakdown({ copilotCost, totalCost }: CostBreakdownProps) {
  if (totalCost <= 0) {
    return null
  }

  const formatCost = (cost: number): string => {
    return `$${cost.toFixed(2)}`
  }

  const workflowExecutionCost = totalCost - copilotCost

  return (
    <div className='rounded-[8px] border bg-[var(--surface-3)] p-3 shadow-xs'>
      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <span className='font-medium text-[var(--text-muted)] text-sm'>Cost Breakdown</span>
        </div>

        <div className='space-y-1.5'>
          <div className='flex items-center justify-between'>
            <span className='text-[var(--text-muted)] text-xs'>Workflow Executions:</span>
            <span className='text-[var(--text-primary)] text-xs tabular-nums'>
              {formatCost(workflowExecutionCost)}
            </span>
          </div>

          <div className='flex items-center justify-between'>
            <span className='text-[var(--text-muted)] text-xs'>Copilot:</span>
            <span className='text-[var(--text-primary)] text-xs tabular-nums'>
              {formatCost(copilotCost)}
            </span>
          </div>

          <div className='flex items-center justify-between border-[var(--border)] border-t pt-1.5'>
            <span className='font-medium text-[var(--text-primary)] text-xs'>Total:</span>
            <span className='font-medium text-[var(--text-primary)] text-xs tabular-nums'>
              {formatCost(totalCost)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
