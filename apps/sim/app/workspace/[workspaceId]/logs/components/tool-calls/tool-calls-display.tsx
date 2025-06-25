'use client'

import { useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Clock } from 'lucide-react'
import { CopyButton } from '@/components/ui/copy-button'
import { cn } from '@/lib/utils'
import type { ToolCall, ToolCallMetadata } from '../../stores/types'

interface ToolCallsDisplayProps {
  metadata: ToolCallMetadata
}

export function ToolCallsDisplay({ metadata }: ToolCallsDisplayProps) {
  if (!metadata.toolCalls || metadata.toolCalls.length === 0) {
    return <div className='text-muted-foreground text-sm'>No tool calls recorded</div>
  }

  return (
    <div className='space-y-2'>
      <div className='rounded-md border bg-secondary/20'>
        {metadata.toolCalls.map((toolCall, index) => (
          <ToolCallItem key={index} toolCall={toolCall} index={index} />
        ))}
      </div>
    </div>
  )
}

interface ToolCallItemProps {
  toolCall: ToolCall
  index: number
}

function ToolCallItem({ toolCall, index }: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(false)

  // Always show exact milliseconds for duration
  const formattedDuration = toolCall.duration ? `${toolCall.duration}ms` : 'N/A'

  // Determine status color
  const statusColor = toolCall.status === 'success' ? 'text-green-500' : 'text-red-500'
  const StatusIcon = toolCall.status === 'success' ? CheckCircle2 : AlertCircle

  return (
    <div className={cn('border-b last:border-b-0', expanded ? 'bg-secondary/30' : '')}>
      {/* Tool call header */}
      <div
        className='flex cursor-pointer items-center p-2 transition-colors hover:bg-secondary/40'
        onClick={() => setExpanded(!expanded)}
      >
        <div className='mr-1'>
          {expanded ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />}
        </div>

        <div className='flex flex-1 items-center'>
          <span className='font-medium text-sm'>{toolCall.name}</span>
          <div className='ml-auto flex items-center gap-3 text-muted-foreground text-xs'>
            <div className='flex items-center gap-1'>
              <Clock className='h-3 w-3' />
              <span>{formattedDuration}</span>
            </div>
            <div className={cn('flex items-center gap-1', statusColor)}>
              <StatusIcon className='h-3 w-3' />
              <span className='capitalize'>{toolCall.status}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tool call details */}
      {expanded && (
        <div className='border-t bg-secondary/20 p-3 text-xs'>
          <div className='space-y-4'>
            {/* Timing information */}
            <div className='grid grid-cols-2 gap-2'>
              <div>
                <div className='mb-1 text-muted-foreground'>Start Time</div>
                <div className='group relative font-mono'>
                  {toolCall.startTime && isValidDate(toolCall.startTime) ? (
                    <>
                      <CopyButton
                        text={formatDateWithMilliseconds(new Date(toolCall.startTime))}
                        showLabel={false}
                      />
                      {formatDateWithMilliseconds(new Date(toolCall.startTime))}
                    </>
                  ) : (
                    'Not available'
                  )}
                </div>
              </div>
              <div>
                <div className='mb-1 text-muted-foreground'>End Time</div>
                <div className='group relative font-mono'>
                  {toolCall.endTime && isValidDate(toolCall.endTime) ? (
                    <>
                      <CopyButton
                        text={formatDateWithMilliseconds(new Date(toolCall.endTime))}
                        showLabel={false}
                      />
                      {formatDateWithMilliseconds(new Date(toolCall.endTime))}
                    </>
                  ) : (
                    'Not available'
                  )}
                </div>
              </div>
            </div>

            {/* Input */}
            {toolCall.input && (
              <div>
                <div className='mb-1 text-muted-foreground'>Input</div>
                <pre className='group relative max-h-32 overflow-auto rounded bg-background p-2'>
                  <CopyButton text={JSON.stringify(toolCall.input, null, 2)} />
                  <code>{JSON.stringify(toolCall.input, null, 2)}</code>
                </pre>
              </div>
            )}

            {/* Output or Error */}
            {toolCall.status === 'success' && toolCall.output && (
              <div>
                <div className='mb-1 text-muted-foreground'>Output</div>
                <pre className='group relative max-h-32 overflow-auto rounded bg-background p-2'>
                  <CopyButton text={JSON.stringify(toolCall.output, null, 2)} />
                  <code>{JSON.stringify(toolCall.output, null, 2)}</code>
                </pre>
              </div>
            )}

            {toolCall.status === 'error' && toolCall.error && (
              <div>
                <div className='mb-1 text-destructive'>Error</div>
                <pre className='group relative max-h-32 overflow-auto rounded bg-destructive/10 p-2 text-destructive'>
                  <CopyButton text={toolCall.error} />
                  <code>{toolCall.error}</code>
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Helper function to check if a string is a valid date
 */
function isValidDate(dateString: string): boolean {
  if (!dateString) return false

  try {
    const timestamp = Date.parse(dateString)
    return !Number.isNaN(timestamp)
  } catch (_e) {
    return false
  }
}

/**
 * Format a date with millisecond precision
 */
function formatDateWithMilliseconds(date: Date): string {
  // Get hours, minutes, seconds components
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const seconds = date.getSeconds().toString().padStart(2, '0')

  // Get milliseconds and format to 3 digits
  const milliseconds = date.getMilliseconds().toString().padStart(3, '0')

  // Format as HH:MM:SS.mmm
  return `${hours}:${minutes}:${seconds}.${milliseconds}`
}
