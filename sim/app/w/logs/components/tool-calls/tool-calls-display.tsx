'use client'

import { useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ToolCall, ToolCallMetadata } from '../../stores/types'
import { CopyButton } from '../copy-button'

interface ToolCallsDisplayProps {
  metadata: ToolCallMetadata
}

export function ToolCallsDisplay({ metadata }: ToolCallsDisplayProps) {
  if (!metadata.toolCalls || metadata.toolCalls.length === 0) {
    return <div className="text-sm text-muted-foreground">No tool calls recorded</div>
  }

  return (
    <div className="space-y-2">
      <div className="border rounded-md bg-secondary/20">
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
        className="flex items-center p-2 cursor-pointer hover:bg-secondary/40 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="mr-1">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>

        <div className="flex-1 flex items-center">
          <span className="text-sm font-medium">{toolCall.name}</span>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>{formattedDuration}</span>
            </div>
            <div className={cn('flex items-center gap-1', statusColor)}>
              <StatusIcon className="h-3 w-3" />
              <span className="capitalize">{toolCall.status}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tool call details */}
      {expanded && (
        <div className="p-3 bg-secondary/20 text-xs border-t">
          <div className="space-y-4">
            {/* Timing information */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-muted-foreground mb-1">Start Time</div>
                <div className="font-mono relative group">
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
                <div className="text-muted-foreground mb-1">End Time</div>
                <div className="font-mono relative group">
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
                <div className="text-muted-foreground mb-1">Input</div>
                <pre className="bg-background rounded p-2 overflow-auto max-h-32 relative group">
                  <CopyButton text={JSON.stringify(toolCall.input, null, 2)} />
                  <code>{JSON.stringify(toolCall.input, null, 2)}</code>
                </pre>
              </div>
            )}

            {/* Output or Error */}
            {toolCall.status === 'success' && toolCall.output && (
              <div>
                <div className="text-muted-foreground mb-1">Output</div>
                <pre className="bg-background rounded p-2 overflow-auto max-h-32 relative group">
                  <CopyButton text={JSON.stringify(toolCall.output, null, 2)} />
                  <code>{JSON.stringify(toolCall.output, null, 2)}</code>
                </pre>
              </div>
            )}

            {toolCall.status === 'error' && toolCall.error && (
              <div>
                <div className="text-destructive mb-1">Error</div>
                <pre className="bg-destructive/10 text-destructive rounded p-2 overflow-auto max-h-32 relative group">
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
    return !isNaN(timestamp)
  } catch (e) {
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
