'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { WorkflowLog } from '@/app/w/logs/stores/types'
import { formatDate } from '@/app/w/logs/utils/format-date'
import { formatCost } from '@/providers/utils'
import { ToolCallsDisplay } from '../tool-calls/tool-calls-display'
import { TraceSpansDisplay } from '../trace-spans/trace-spans-display'

interface LogSidebarProps {
  log: WorkflowLog | null
  isOpen: boolean
  onClose: () => void
  onNavigateNext?: () => void
  onNavigatePrev?: () => void
  hasNext?: boolean
  hasPrev?: boolean
}

/**
 * Formats JSON content for display, handling multiple JSON objects separated by '--'
 */
const formatJsonContent = (content: string): React.ReactNode => {
  // Check if the content has multiple parts separated by '--'
  const parts = content.split(/\s*--\s*/g).filter((part) => part.trim().length > 0)

  if (parts.length > 1) {
    // Handle multiple parts
    return (
      <div className="space-y-4">
        {parts.map((part, index) => (
          <div key={index} className="border-b pb-4 last:border-b-0 last:pb-0">
            {formatSingleJsonContent(part)}
          </div>
        ))}
      </div>
    )
  }

  // Handle single part
  return formatSingleJsonContent(content)
}

/**
 * Formats a single JSON content part
 */
const formatSingleJsonContent = (content: string): React.ReactNode => {
  try {
    // Try to parse the content as JSON
    const jsonStart = content.indexOf('{')
    if (jsonStart === -1) return <div className="text-sm break-words">{content}</div>

    const messagePart = content.substring(0, jsonStart).trim()
    const jsonPart = content.substring(jsonStart)

    try {
      const jsonData = JSON.parse(jsonPart)

      return (
        <div>
          {messagePart && <div className="mb-2 font-medium text-sm break-words">{messagePart}</div>}
          <div className="bg-secondary/50 p-3 rounded-md relative group">
            <CopyButton text={JSON.stringify(jsonData, null, 2)} />
            <pre className="text-xs whitespace-pre-wrap break-all max-w-full overflow-hidden">
              <code>{JSON.stringify(jsonData, null, 2)}</code>
            </pre>
          </div>
        </div>
      )
    } catch (e) {
      // If JSON parsing fails, try to find and format any valid JSON objects in the content
      const jsonRegex = /{[^{}]*({[^{}]*})*[^{}]*}/g
      const jsonMatches = content.match(jsonRegex)

      if (jsonMatches && jsonMatches.length > 0) {
        return (
          <div>
            {messagePart && (
              <div className="mb-2 font-medium text-sm break-words">{messagePart}</div>
            )}
            {jsonMatches.map((jsonStr, idx) => {
              try {
                const parsedJson = JSON.parse(jsonStr)
                return (
                  <div key={idx} className="bg-secondary/50 p-3 rounded-md mt-2 relative group">
                    <CopyButton text={JSON.stringify(parsedJson, null, 2)} />
                    <pre className="text-xs whitespace-pre-wrap break-all max-w-full overflow-hidden">
                      <code>{JSON.stringify(parsedJson, null, 2)}</code>
                    </pre>
                  </div>
                )
              } catch {
                return (
                  <div key={idx} className="mt-2 text-sm break-words relative group">
                    <CopyButton text={jsonStr} />
                    {jsonStr}
                  </div>
                )
              }
            })}
          </div>
        )
      }
    }
  } catch (e) {
    // If all parsing fails, return the original content
  }

  return (
    <div className="text-sm break-words relative group">
      <CopyButton text={content} />
      {content}
    </div>
  )
}

export function Sidebar({
  log,
  isOpen,
  onClose,
  onNavigateNext,
  onNavigatePrev,
  hasNext = false,
  hasPrev = false,
}: LogSidebarProps) {
  const [width, setWidth] = useState(500) // Default width from the original styles
  const [isDragging, setIsDragging] = useState(false)
  const [currentLogId, setCurrentLogId] = useState<string | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Update currentLogId when log changes
  useEffect(() => {
    if (log?.id) {
      setCurrentLogId(log.id)
    }
  }, [log?.id])

  const formattedContent = useMemo(() => {
    if (!log) return null
    return formatJsonContent(log.message)
  }, [log])

  // Reset scroll position when log changes
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = 0
    }
  }, [log?.id])

  // Determine if this is a workflow execution log
  const isWorkflowExecutionLog = useMemo(() => {
    if (!log) return false
    // Check if message contains "workflow executed" or similar phrases
    return (
      log.message.toLowerCase().includes('workflow executed') ||
      log.message.toLowerCase().includes('execution completed') ||
      (log.trigger === 'manual' && log.duration)
    )
  }, [log])

  // Helper to determine if we have trace spans to display
  const hasTraceSpans = useMemo(() => {
    return !!(log?.metadata?.traceSpans && log.metadata.traceSpans.length > 0)
  }, [log])

  // Helper to determine if we have cost information to display
  const hasCostInfo = useMemo(() => {
    return !!(log?.metadata?.cost && (log.metadata.cost.input || log.metadata.cost.output))
  }, [log])

  const isWorkflowWithCost = useMemo(() => {
    return isWorkflowExecutionLog && hasCostInfo
  }, [isWorkflowExecutionLog, hasCostInfo])

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    e.preventDefault()
    e.stopPropagation()
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newWidth = window.innerWidth - e.clientX
        // Maintain minimum and maximum widths
        setWidth(Math.max(400, Math.min(newWidth, window.innerWidth * 0.8)))
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  // Handle escape key to close the sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }

      // Add keyboard shortcuts for navigation
      if (isOpen) {
        // Up arrow key for previous log
        if (e.key === 'ArrowUp' && hasPrev && onNavigatePrev) {
          e.preventDefault()
          handleNavigate(onNavigatePrev)
        }

        // Down arrow key for next log
        if (e.key === 'ArrowDown' && hasNext && onNavigateNext) {
          e.preventDefault()
          handleNavigate(onNavigateNext)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, hasPrev, hasNext, onNavigatePrev, onNavigateNext])

  // Handle navigation
  const handleNavigate = (navigateFunction: () => void) => {
    navigateFunction()
  }

  return (
    <div
      className={`fixed inset-y-0 right-0 bg-background border-l shadow-lg transform transition-transform duration-200 ease-in-out z-50 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
      style={{ top: '64px', width: `${width}px` }}
    >
      <div
        className="absolute left-[-4px] top-0 bottom-0 w-4 cursor-ew-resize hover:bg-accent/50 z-50"
        onMouseDown={handleMouseDown}
      />
      {log && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h2 className="text-base font-medium">Log Details</h2>
            <div className="flex items-center space-x-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 p-0"
                      onClick={() => hasPrev && handleNavigate(onNavigatePrev!)}
                      disabled={!hasPrev}
                      aria-label="Previous log"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Previous log (↑)</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 p-0"
                      onClick={() => hasNext && handleNavigate(onNavigateNext!)}
                      disabled={!hasNext}
                      aria-label="Next log"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Next log (↓)</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 p-0"
                onClick={onClose}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <ScrollArea className="h-[calc(100vh-64px-49px)]" ref={scrollAreaRef}>
            {' '}
            {/* Adjust for header height */}
            <div className="p-4 space-y-4">
              {/* Timestamp */}
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-1">Timestamp</h3>
                <p className="text-sm relative group">
                  <CopyButton text={formatDate(log.createdAt).full} />
                  {formatDate(log.createdAt).full}
                </p>
              </div>

              {/* Workflow */}
              {log.workflow && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">Workflow</h3>
                  <div
                    className="inline-flex items-center px-2 py-1 text-xs rounded-md relative group"
                    style={{
                      backgroundColor: `${log.workflow.color}20`,
                      color: log.workflow.color,
                    }}
                  >
                    <CopyButton text={log.workflow.name} />
                    {log.workflow.name}
                  </div>
                </div>
              )}

              {/* Execution ID */}
              {log.executionId && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">Execution ID</h3>
                  <p className="text-sm font-mono break-all relative group">
                    <CopyButton text={log.executionId} />
                    {log.executionId}
                  </p>
                </div>
              )}

              {/* Level */}
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-1">Level</h3>
                <p className="text-sm capitalize relative group">
                  <CopyButton text={log.level} />
                  {log.level}
                </p>
              </div>

              {/* Trigger */}
              {log.trigger && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">Trigger</h3>
                  <p className="text-sm capitalize relative group">
                    <CopyButton text={log.trigger} />
                    {log.trigger}
                  </p>
                </div>
              )}

              {/* Duration */}
              {log.duration && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">Duration</h3>
                  <p className="text-sm relative group">
                    <CopyButton text={log.duration} />
                    {log.duration}
                  </p>
                </div>
              )}

              {/* Trace Spans (if available and this is a workflow execution log) */}
              {isWorkflowExecutionLog && log.metadata?.traceSpans && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">Trace Spans</h3>
                  <TraceSpansDisplay
                    traceSpans={log.metadata.traceSpans}
                    totalDuration={log.metadata.totalDuration}
                  />
                </div>
              )}

              {/* Tool Calls (if available) */}
              {log.metadata?.toolCalls && log.metadata.toolCalls.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">Tool Calls</h3>
                  <ToolCallsDisplay metadata={log.metadata} />
                </div>
              )}

              {/* Cost Information (if available) */}
              {hasCostInfo && log.metadata?.cost && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">
                    {isWorkflowWithCost ? 'Total Model Cost' : 'Model Cost'}
                  </h3>
                  <div
                    className={`space-y-1 text-sm ${isWorkflowWithCost ? 'border rounded-md p-3 bg-muted/10' : ''}`}
                  >
                    {log.metadata.cost.model && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Model:</span>
                        <span>{log.metadata.cost.model}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Input:</span>
                      <span>{formatCost(log.metadata.cost.input || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Output:</span>
                      <span>{formatCost(log.metadata.cost.output || 0)}</span>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span className="text-muted-foreground">Total:</span>
                      <span className={isWorkflowWithCost ? 'text-primary font-bold' : ''}>
                        {formatCost(log.metadata.cost.total || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Tokens:</span>
                      <span>
                        {log.metadata.cost.tokens?.prompt || 0} in /{' '}
                        {log.metadata.cost.tokens?.completion || 0} out
                      </span>
                    </div>

                    {isWorkflowWithCost && (
                      <div className="border-t mt-2 pt-2 text-xs text-muted-foreground">
                        <p>
                          This is the total cost for all agent blocks in this workflow execution.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Message Content */}
              <div className="pb-2">
                <h3 className="text-xs font-medium text-muted-foreground mb-1">Message</h3>
                <div>{formattedContent}</div>
              </div>
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  )
}
