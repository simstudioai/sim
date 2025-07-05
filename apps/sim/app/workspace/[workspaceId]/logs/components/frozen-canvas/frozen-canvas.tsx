'use client'

import { useEffect, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('FrozenCanvas')

interface FrozenCanvasData {
  executionId: string
  workflowId: string
  workflowState: WorkflowState
  blockExecutions: Record<string, any>
  executionMetadata: {
    trigger: string
    startedAt: string
    endedAt?: string
    totalDurationMs?: number
    blockStats: {
      total: number
      success: number
      error: number
      skipped: number
    }
    cost: {
      total: number | null
      input: number | null
      output: number | null
    }
    totalTokens: number | null
  }
}

interface FrozenCanvasProps {
  executionId: string
  className?: string
  height?: string | number
  width?: string | number
}

// No need for custom node types - we'll use WorkflowPreview

export function FrozenCanvas({ executionId, className, height = '100%', width = '100%' }: FrozenCanvasProps) {
  const [data, setData] = useState<FrozenCanvasData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch frozen canvas data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch(`/api/logs/${executionId}/frozen-canvas`)
        if (!response.ok) {
          throw new Error(`Failed to fetch frozen canvas data: ${response.statusText}`)
        }

        const result = await response.json()
        setData(result)
        logger.debug(`Loaded frozen canvas data for execution: ${executionId}`)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        logger.error('Failed to fetch frozen canvas data:', err)
        setError(errorMessage)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [executionId])

  // No need to create a temporary workflow - just use the workflowState directly

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center', className)} style={{ height, width }}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading frozen canvas...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('flex items-center justify-center', className)} style={{ height, width }}>
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <span>Failed to load frozen canvas: {error}</span>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className={cn('flex items-center justify-center', className)} style={{ height, width }}>
        <div className="text-muted-foreground">No data available</div>
      </div>
    )
  }

  // Debug: Log the snapshot data structure
  console.log('Snapshot data structure:', {
    workflowState: data.workflowState,
    blockCount: Object.keys(data.workflowState.blocks || {}).length,
    blockTypes: Object.entries(data.workflowState.blocks || {}).map(([id, block]) => ({
      id,
      type: block?.type,
      hasType: !!block?.type
    }))
  })

  return (
    <div
      style={{ height, width }}
      className={cn('frozen-canvas-mode h-full w-full', className)}
    >
      <WorkflowPreview
        workflowState={data.workflowState}
        showSubBlocks={true}
        isPannable={true}
      />
    </div>
  )
}
