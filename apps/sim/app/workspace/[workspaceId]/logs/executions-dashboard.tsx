'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

type TimeFilter = '1w' | '24h' | '12h' | '1h'

interface WorkflowExecution {
  workflowId: string
  workflowName: string
  segments: {
    successRate: number // 0-100
    timestamp: string
    hasExecutions: boolean
    totalExecutions: number
    successfulExecutions: number
  }[]
  overallSuccessRate: number
}

const BAR_COUNT = 120

function StatusBar({ segments }: { segments: { successRate: number; hasExecutions: boolean; totalExecutions: number; successfulExecutions: number }[] }) {
  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex gap-[1px] items-center">
        {segments.map((segment, i) => {
          console.log(`Segment ${i}:`, segment)
          let color: string
          let tooltipContent: React.ReactNode
          
          if (!segment.hasExecutions) {
            color = 'bg-gray-300 dark:bg-gray-600'
            tooltipContent = (
              <div className="text-center">
                <div className="font-medium">No executions</div>
              </div>
            )
          } else {
            if (segment.successRate === 100) {
              color = 'bg-emerald-500'
            } else if (segment.successRate >= 95) {
              color = 'bg-amber-500'
            } else {
              color = 'bg-red-500'
            }
            
            tooltipContent = (
              <div className="text-center">
                <div className="font-semibold">{segment.successRate.toFixed(1)}%</div>
                <div className="text-xs mt-1">
                  {segment.successfulExecutions ?? 0}/{segment.totalExecutions ?? 0} executions succeeded
                </div>
              </div>
            )
          }
          
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <div
                  className={`h-8 w-2 rounded-[1px] ${color} transition-opacity hover:opacity-80 cursor-default`}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="px-3 py-2">
                {tooltipContent}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

export default function ExecutionsDashboard() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('24h')
  const [executions, setExecutions] = useState<WorkflowExecution[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchExecutions = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch(
        `/api/workspaces/${workspaceId}/execution-history?timeFilter=${timeFilter}&segments=${BAR_COUNT}`
      )
      
      if (!response.ok) {
        throw new Error('Failed to fetch execution history')
      }
      
      const data = await response.json()
      console.log('Execution data:', data.workflows[0]?.segments[0])
      setExecutions(data.workflows)
    } catch (err) {
      console.error('Error fetching executions:', err)
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, timeFilter])

  useEffect(() => {
    fetchExecutions()
  }, [fetchExecutions])

  const getTimeFilterLabel = (filter: TimeFilter) => {
    switch (filter) {
      case '1w':
        return '1 Week'
      case '24h':
        return '24 Hours'
      case '12h':
        return '12 Hours'
      case '1h':
        return '1 Hour'
    }
  }

  const getDateRange = () => {
    const now = new Date()
    const start = new Date()
    
    switch (timeFilter) {
      case '1w':
        start.setDate(now.getDate() - 7)
        break
      case '24h':
        start.setHours(now.getHours() - 24)
        break
      case '12h':
        start.setHours(now.getHours() - 12)
        break
      case '1h':
        start.setHours(now.getHours() - 1)
        break
    }
    
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  }

  return (
    <div className="flex h-full flex-col pl-64 p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-semibold">Execution History</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Monitor workflow execution success rates over time
            </p>
          </div>
          
          {/* Time Filters */}
          <div className="flex gap-2">
            {(['1h', '12h', '24h', '1w'] as TimeFilter[]).map((filter) => (
              <Button
                key={filter}
                variant={timeFilter === filter ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTimeFilter(filter)}
              >
                {getTimeFilterLabel(filter)}
              </Button>
            ))}
          </div>
        </div>
        
        <div className="text-sm text-muted-foreground">
          {getDateRange()}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading execution history...</span>
          </div>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-destructive">
            <p className="font-medium">Error loading data</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      ) : executions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <p className="font-medium">No execution history</p>
            <p className="text-sm mt-1">Execute some workflows to see their history here</p>
          </div>
        </div>
      ) : (
        <div className="border rounded-lg bg-card overflow-hidden" style={{ maxHeight: '600px' }}>
          <ScrollArea className="h-full">
            <div className="p-6 space-y-4">
              {executions.map((workflow) => (
                <div
                  key={workflow.workflowId}
                  className="flex items-center gap-6"
                >
                  <div className="flex-shrink-0 w-52 min-w-0">
                    <h3 className="font-medium text-sm truncate" title={workflow.workflowName}>
                      {workflow.workflowName}
                    </h3>
                  </div>
                  
                  <div className="flex-1">
                    <StatusBar segments={workflow.segments} />
                  </div>
                  
                  <div className="flex-shrink-0 w-16 text-right">
                    <span className="text-sm text-muted-foreground font-medium">
                      {workflow.overallSuccessRate.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
