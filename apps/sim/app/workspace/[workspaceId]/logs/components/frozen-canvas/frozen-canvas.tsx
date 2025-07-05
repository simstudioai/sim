'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Clock, DollarSign, Hash, Loader2, X, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { ExecutionDataTooltip } from './execution-data-tooltip'

const logger = createLogger('FrozenCanvas')

// Helper function to redact sensitive data
function redactSensitiveData(obj: any): any {
  if (obj === null || obj === undefined) return obj

  if (typeof obj === 'string') {
    // Redact API keys (OpenAI, Anthropic, etc.)
    if (obj.match(/^sk-[a-zA-Z0-9_-]+$/)) {
      return `${obj.substring(0, 7)}...${obj.substring(obj.length - 4)}`
    }
    // Redact other potential API keys
    if (obj.match(/^[a-zA-Z0-9_-]{20,}$/)) {
      return `${obj.substring(0, 4)}...${obj.substring(obj.length - 4)}`
    }
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveData)
  }

  if (typeof obj === 'object') {
    const redacted: any = {}
    for (const [key, value] of Object.entries(obj)) {
      // Redact known sensitive field names
      if (
        key.toLowerCase().includes('apikey') ||
        key.toLowerCase().includes('api_key') ||
        key.toLowerCase().includes('token') ||
        key.toLowerCase().includes('secret') ||
        key.toLowerCase().includes('password')
      ) {
        if (typeof value === 'string' && value.length > 8) {
          redacted[key] = `${value.substring(0, 7)}...${value.substring(value.length - 4)}`
        } else {
          redacted[key] = '[REDACTED]'
        }
      } else {
        redacted[key] = redactSensitiveData(value)
      }
    }
    return redacted
  }

  return obj
}

// Helper function to format execution data for display
function formatExecutionData(executionData: any) {
  const { inputData, outputData, cost, tokens, durationMs, status, blockName, blockType } =
    executionData

  return {
    blockName: blockName || 'Unknown Block',
    blockType: blockType || 'unknown',
    status,
    duration: durationMs ? `${durationMs}ms` : 'N/A',
    input: redactSensitiveData(inputData || {}),
    output: redactSensitiveData(outputData || {}),
    cost: cost
      ? {
          input: cost.input || 0,
          output: cost.output || 0,
          total: cost.total || 0,
        }
      : null,
    tokens: tokens
      ? {
          prompt: tokens.prompt || 0,
          completion: tokens.completion || 0,
          total: tokens.total || 0,
        }
      : null,
  }
}

// PinnedLogs component
function PinnedLogs({ executionData, onClose }: { executionData: any; onClose: () => void }) {
  const formatted = formatExecutionData(executionData)

  return (
    <Card className='fixed top-4 right-4 z-[100] max-h-[calc(100vh-8rem)] w-96 overflow-y-auto border-border bg-background shadow-lg'>
      <CardHeader className='pb-3'>
        <div className='flex items-center justify-between'>
          <CardTitle className='flex items-center gap-2 text-foreground text-lg'>
            <Zap className='h-5 w-5' />
            {formatted.blockName}
          </CardTitle>
          <button onClick={onClose} className='rounded-sm p-1 text-foreground hover:bg-muted'>
            <X className='h-4 w-4' />
          </button>
        </div>
        <div className='flex items-center gap-2'>
          <Badge variant={formatted.status === 'success' ? 'default' : 'destructive'}>
            {formatted.blockType}
          </Badge>
          <Badge variant='outline'>{formatted.status}</Badge>
        </div>
      </CardHeader>

      <CardContent className='space-y-4'>
        {/* Performance Metrics */}
        <div className='grid grid-cols-2 gap-4'>
          <div className='flex items-center gap-2'>
            <Clock className='h-4 w-4 text-muted-foreground' />
            <span className='text-foreground text-sm'>{formatted.duration}</span>
          </div>

          {formatted.cost && (
            <div className='flex items-center gap-2'>
              <DollarSign className='h-4 w-4 text-muted-foreground' />
              <span className='text-foreground text-sm'>${formatted.cost.total.toFixed(5)}</span>
            </div>
          )}

          {formatted.tokens && (
            <div className='flex items-center gap-2'>
              <Hash className='h-4 w-4 text-muted-foreground' />
              <span className='text-foreground text-sm'>{formatted.tokens.total} tokens</span>
            </div>
          )}
        </div>

        {/* Input Data */}
        <div>
          <h4 className='mb-2 font-medium text-foreground text-sm'>Input</h4>
          <div className='max-h-32 overflow-y-auto rounded bg-muted p-3 font-mono text-xs'>
            <pre className='text-foreground'>{JSON.stringify(formatted.input, null, 2)}</pre>
          </div>
        </div>

        {/* Output Data */}
        <div>
          <h4 className='mb-2 font-medium text-foreground text-sm'>Output</h4>
          <div className='max-h-32 overflow-y-auto rounded bg-muted p-3 font-mono text-xs'>
            <pre className='text-foreground'>{JSON.stringify(formatted.output, null, 2)}</pre>
          </div>
        </div>

        {/* Detailed Cost Breakdown */}
        {formatted.cost && (
          <div>
            <h4 className='mb-2 font-medium text-foreground text-sm'>Cost Breakdown</h4>
            <div className='space-y-1 text-sm'>
              <div className='flex justify-between text-foreground'>
                <span>Input:</span>
                <span>${formatted.cost.input.toFixed(5)}</span>
              </div>
              <div className='flex justify-between text-foreground'>
                <span>Output:</span>
                <span>${formatted.cost.output.toFixed(5)}</span>
              </div>
              <div className='flex justify-between border-border border-t pt-1 font-medium text-foreground'>
                <span>Total:</span>
                <span>${formatted.cost.total.toFixed(5)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Detailed Token Breakdown */}
        {formatted.tokens && (
          <div>
            <h4 className='mb-2 font-medium text-foreground text-sm'>Token Usage</h4>
            <div className='space-y-1 text-sm'>
              <div className='flex justify-between text-foreground'>
                <span>Prompt:</span>
                <span>{formatted.tokens.prompt}</span>
              </div>
              <div className='flex justify-between text-foreground'>
                <span>Completion:</span>
                <span>{formatted.tokens.completion}</span>
              </div>
              <div className='flex justify-between border-border border-t pt-1 font-medium text-foreground'>
                <span>Total:</span>
                <span>{formatted.tokens.total}</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

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

export function FrozenCanvas({
  executionId,
  className,
  height = '100%',
  width = '100%',
}: FrozenCanvasProps) {
  const [data, setData] = useState<FrozenCanvasData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [pinnedBlockId, setPinnedBlockId] = useState<string | null>(null)

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
        console.log('Frozen canvas API response:', result)
        console.log('Block executions from API:', result.blockExecutions)
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

  // Set up click outside handler to close tooltip
  useEffect(() => {
    const handleClickOutside = (event: Event) => {
      const mouseEvent = event as MouseEvent
      const target = mouseEvent.target as HTMLElement
      const isTooltip = target.closest('.execution-data-tooltip')

      if (!isTooltip) {
        setSelectedBlockId(null)
      }
    }

    document.addEventListener('click', handleClickOutside)

    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [])

  // No need to create a temporary workflow - just use the workflowState directly

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center', className)} style={{ height, width }}>
        <div className='flex items-center gap-2 text-muted-foreground'>
          <Loader2 className='h-5 w-5 animate-spin' />
          <span>Loading frozen canvas...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('flex items-center justify-center', className)} style={{ height, width }}>
        <div className='flex items-center gap-2 text-destructive'>
          <AlertCircle className='h-5 w-5' />
          <span>Failed to load frozen canvas: {error}</span>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className={cn('flex items-center justify-center', className)} style={{ height, width }}>
        <div className='text-muted-foreground'>No data available</div>
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
      hasType: !!block?.type,
    })),
  })

  return (
    <>
      <div style={{ height, width }} className={cn('frozen-canvas-mode h-full w-full', className)}>
        <WorkflowPreview
          workflowState={data.workflowState}
          showSubBlocks={true}
          isPannable={true}
          onNodeClick={(blockId, mousePosition) => {
            console.log('Block clicked in frozen canvas:', blockId)
            console.log('Available execution data:', Object.keys(data.blockExecutions))
            console.log('Execution data for block:', data.blockExecutions[blockId])

            if (data.blockExecutions[blockId]) {
              // Pin the logs for this block
              setPinnedBlockId(blockId)
              // Also show tooltip for immediate feedback
              setSelectedBlockId(blockId)
              setMousePosition(mousePosition)
            } else {
              console.warn('No execution data found for block:', blockId)
            }
          }}
        />
      </div>

      {/* Execution Data Tooltip */}
      {selectedBlockId && data.blockExecutions[selectedBlockId] && (
        <ExecutionDataTooltip
          executionData={data.blockExecutions[selectedBlockId]}
          mousePosition={mousePosition}
          isVisible={true}
          onClose={() => setSelectedBlockId(null)}
        />
      )}

      {/* Pinned Logs */}
      {pinnedBlockId && data.blockExecutions[pinnedBlockId] && (
        <PinnedLogs
          executionData={data.blockExecutions[pinnedBlockId]}
          onClose={() => setPinnedBlockId(null)}
        />
      )}
    </>
  )
}
