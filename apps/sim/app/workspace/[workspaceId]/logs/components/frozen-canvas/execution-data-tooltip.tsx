'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, Clock, XCircle } from 'lucide-react'
import { createPortal } from 'react-dom'

interface ExecutionData {
  blockId: string
  blockName: string
  blockType: string
  status: 'success' | 'error' | 'skipped'
  startedAt: string
  endedAt?: string
  durationMs?: number
  inputData: any
  outputData: any
  errorMessage?: string
  cost?: {
    input: number | null
    output: number | null
    total: number | null
  }
  tokens?: {
    prompt: number | null
    completion: number | null
    total: number | null
  }
  modelUsed?: string
}

interface ExecutionDataTooltipProps {
  executionData: ExecutionData
  mousePosition: { x: number; y: number }
  isVisible: boolean
}

function formatJsonForDisplay(data: any): string {
  if (data === null || data === undefined) return 'null'
  if (typeof data === 'string') return data
  if (typeof data === 'number' || typeof data === 'boolean') return String(data)

  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'success':
      return <CheckCircle className='h-4 w-4 text-green-500' />
    case 'error':
      return <XCircle className='h-4 w-4 text-red-500' />
    case 'skipped':
      return <Clock className='h-4 w-4 text-yellow-500' />
    default:
      return <AlertCircle className='h-4 w-4 text-gray-500' />
  }
}

export function ExecutionDataTooltip({
  executionData,
  mousePosition,
  isVisible,
}: ExecutionDataTooltipProps) {
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isVisible || !tooltipRef.current) return

    const tooltip = tooltipRef.current
    const rect = tooltip.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let x = mousePosition.x + 10
    let y = mousePosition.y + 10

    // Adjust if tooltip would go off screen
    if (x + rect.width > viewportWidth) {
      x = mousePosition.x - rect.width - 10
    }
    if (y + rect.height > viewportHeight) {
      y = mousePosition.y - rect.height - 10
    }

    setTooltipPosition({ x, y })
  }, [mousePosition, isVisible])

  if (!isVisible) return null

  return createPortal(
    <div
      ref={tooltipRef}
      className='fixed z-[9999] max-w-md overflow-hidden rounded-lg border bg-white shadow-lg'
      style={{
        left: tooltipPosition.x,
        top: tooltipPosition.y,
        pointerEvents: 'none',
      }}
    >
      {/* Header */}
      <div className='border-b bg-gray-50 px-3 py-2'>
        <div className='font-medium text-sm'>{executionData.blockName}</div>
        <div className='text-muted-foreground text-xs'>{executionData.blockType}</div>
      </div>

      {/* Content */}
      <div className='max-h-96 space-y-3 overflow-y-auto p-3'>
        {/* Execution Status */}
        <div>
          <div className='mb-1 font-medium text-muted-foreground text-xs'>Status</div>
          <div className='flex items-center gap-2'>
            {getStatusIcon(executionData.status)}
            <span className='text-sm'>{executionData.status}</span>
            {executionData.durationMs && (
              <span className='text-muted-foreground text-xs'>({executionData.durationMs}ms)</span>
            )}
          </div>
        </div>

        {/* Input Data */}
        {executionData.inputData && (
          <div>
            <div className='mb-1 font-medium text-muted-foreground text-xs'>Input</div>
            <pre className='max-h-32 overflow-y-auto rounded border bg-gray-50 p-2 text-xs'>
              {formatJsonForDisplay(executionData.inputData)}
            </pre>
          </div>
        )}

        {/* Output Data */}
        {executionData.outputData && (
          <div>
            <div className='mb-1 font-medium text-muted-foreground text-xs'>Output</div>
            <pre className='max-h-32 overflow-y-auto rounded border bg-gray-50 p-2 text-xs'>
              {formatJsonForDisplay(executionData.outputData)}
            </pre>
          </div>
        )}

        {/* Error Message */}
        {executionData.errorMessage && (
          <div>
            <div className='mb-1 font-medium text-red-600 text-xs'>Error</div>
            <div className='rounded border bg-red-50 p-2 text-red-700 text-xs'>
              {executionData.errorMessage}
            </div>
          </div>
        )}

        {/* Cost and Token Info */}
        {(executionData.cost?.total || executionData.tokens?.total) && (
          <div className='flex gap-4 text-xs'>
            {executionData.cost?.total && (
              <div>
                <span className='text-muted-foreground'>Cost:</span>{' '}
                <span className='font-medium'>${executionData.cost.total.toFixed(6)}</span>
              </div>
            )}
            {executionData.tokens?.total && (
              <div>
                <span className='text-muted-foreground'>Tokens:</span>{' '}
                <span className='font-medium'>{executionData.tokens.total}</span>
              </div>
            )}
          </div>
        )}

        {/* Model Used */}
        {executionData.modelUsed && (
          <div className='text-xs'>
            <span className='text-muted-foreground'>Model:</span>{' '}
            <span className='font-medium'>{executionData.modelUsed}</span>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
