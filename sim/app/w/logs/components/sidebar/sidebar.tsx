'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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
  // Look for a pattern like "Block Agent 1 (agent):" to separate system comment from content
  const blockPattern = /^(Block .+?\(.+?\):)\s*/
  const match = content.match(blockPattern)

  if (match) {
    const systemComment = match[1]
    const actualContent = content.substring(match[0].length).trim()

    return (
      <div className="w-full">
        <div className="text-sm font-medium mb-2 text-muted-foreground">{systemComment}</div>
        <div className="bg-secondary/30 p-3 rounded-md relative group">
          <CopyButton text={actualContent} />
          <pre className="text-sm whitespace-pre-wrap break-all w-full overflow-y-auto max-h-[500px] overflow-x-hidden">
            {actualContent}
          </pre>
        </div>
      </div>
    )
  }

  // If no system comment pattern found, show the whole content
  return (
    <div className="bg-secondary/30 p-3 rounded-md relative group w-full">
      <CopyButton text={content} />
      <pre className="text-sm whitespace-pre-wrap break-all w-full overflow-y-auto max-h-[500px] overflow-x-hidden">
        {content}
      </pre>
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
  const MIN_WIDTH = 400
  const DEFAULT_WIDTH = 500
  const EXPANDED_WIDTH = 650

  const [width, setWidth] = useState(DEFAULT_WIDTH) // Start with default width
  const [isDragging, setIsDragging] = useState(false)
  const [currentLogId, setCurrentLogId] = useState<string | null>(null)
  const [isTraceExpanded, setIsTraceExpanded] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Update currentLogId when log changes
  useEffect(() => {
    if (log?.id) {
      setCurrentLogId(log.id)
      // Reset trace expanded state when log changes
      setIsTraceExpanded(false)
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

  // Handle trace span expansion state
  const handleTraceSpanToggle = (expanded: boolean) => {
    setIsTraceExpanded(expanded)

    // If a trace span is expanded, increase the sidebar width only if it's currently below the expanded width
    if (expanded) {
      // Only expand if current width is less than expanded width
      if (width < EXPANDED_WIDTH) {
        setWidth(EXPANDED_WIDTH)
      }
    } else {
      // If all trace spans are collapsed, revert to default width only if we're at expanded width
      if (width === EXPANDED_WIDTH) {
        setWidth(DEFAULT_WIDTH)
      }
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    e.preventDefault()
    e.stopPropagation()
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newWidth = window.innerWidth - e.clientX
        // Maintain minimum width and respect expansion state
        const minWidthToUse = isTraceExpanded ? Math.max(MIN_WIDTH, EXPANDED_WIDTH) : MIN_WIDTH
        setWidth(Math.max(minWidthToUse, Math.min(newWidth, window.innerWidth * 0.8)))
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
  }, [isDragging, isTraceExpanded, MIN_WIDTH, EXPANDED_WIDTH, width])

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
      className={`fixed inset-y-0 right-0 bg-background border-l transform ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      } ${isDragging ? '' : 'transition-all duration-300 ease-in-out'} z-50 flex flex-col`}
      style={{ top: '64px', width: `${width}px`, minWidth: `${MIN_WIDTH}px` }}
    >
      <div
        className="absolute left-[-4px] top-0 bottom-0 w-4 cursor-ew-resize hover:bg-accent/50 z-50"
        onMouseDown={handleMouseDown}
      />
      {log && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
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
          <ScrollArea className="h-[calc(100vh-64px-49px)] w-full" ref={scrollAreaRef}>
            <div className="p-4 space-y-4 w-full overflow-hidden pr-6">
              {/* Timestamp */}
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-1">Timestamp</h3>
                <div className="text-sm relative group">
                  <CopyButton text={formatDate(log.createdAt).full} />
                  {formatDate(log.createdAt).full}
                </div>
              </div>

              {/* Workflow */}
              {log.workflow && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">Workflow</h3>
                  <div
                    className="text-sm relative group"
                    style={{
                      color: log.workflow.color,
                    }}
                  >
                    <CopyButton text={log.workflow.name} />
                    <div
                      className="inline-flex items-center px-2 py-1 text-xs rounded-md"
                      style={{
                        backgroundColor: `${log.workflow.color}20`,
                        color: log.workflow.color,
                      }}
                    >
                      {log.workflow.name}
                    </div>
                  </div>
                </div>
              )}

              {/* Execution ID */}
              {log.executionId && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">Execution ID</h3>
                  <div className="text-sm font-mono break-all relative group">
                    <CopyButton text={log.executionId} />
                    {log.executionId}
                  </div>
                </div>
              )}

              {/* Level */}
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-1">Level</h3>
                <div className="text-sm capitalize relative group">
                  <CopyButton text={log.level} />
                  {log.level}
                </div>
              </div>

              {/* Trigger */}
              {log.trigger && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">Trigger</h3>
                  <div className="text-sm capitalize relative group">
                    <CopyButton text={log.trigger} />
                    {log.trigger}
                  </div>
                </div>
              )}

              {/* Duration */}
              {log.duration && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">Duration</h3>
                  <div className="text-sm relative group">
                    <CopyButton text={log.duration} />
                    {log.duration}
                  </div>
                </div>
              )}

              {/* Message Content - MOVED ABOVE the Trace Spans and Cost */}
              <div className="pb-2 w-full">
                <h3 className="text-xs font-medium text-muted-foreground mb-1">Message</h3>
                <div className="w-full">{formattedContent}</div>
              </div>

              {/* Trace Spans (if available and this is a workflow execution log) */}
              {isWorkflowExecutionLog && log.metadata?.traceSpans && (
                <div className="w-full">
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">Trace Spans</h3>
                  <div className="w-full overflow-x-hidden">
                    <TraceSpansDisplay
                      traceSpans={log.metadata.traceSpans}
                      totalDuration={log.metadata.totalDuration}
                      onExpansionChange={handleTraceSpanToggle}
                    />
                  </div>
                </div>
              )}

              {/* Tool Calls (if available) */}
              {log.metadata?.toolCalls && log.metadata.toolCalls.length > 0 && (
                <div className="w-full">
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">Tool Calls</h3>
                  <div className="w-full overflow-x-hidden bg-secondary/30 p-3 rounded-md">
                    <ToolCallsDisplay metadata={log.metadata} />
                  </div>
                </div>
              )}

              {/* Cost Information (moved to bottom) */}
              {hasCostInfo && log.metadata?.cost && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">
                    {isWorkflowWithCost ? 'Total Model Cost' : 'Model Cost'}
                  </h3>
                  <div className="rounded-md border overflow-hidden">
                    <div className="p-3 space-y-2">
                      {log.metadata.cost.model && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Model:</span>
                          <span className="text-sm">{log.metadata.cost.model}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Input:</span>
                        <span className="text-sm">{formatCost(log.metadata.cost.input || 0)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Output:</span>
                        <span className="text-sm">{formatCost(log.metadata.cost.output || 0)}</span>
                      </div>
                      <div className="flex justify-between items-center border-t pt-2 mt-1">
                        <span className="text-sm text-muted-foreground">Total:</span>
                        <span className="text-sm text-foreground">
                          {formatCost(log.metadata.cost.total || 0)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">Tokens:</span>
                        <span className="text-xs text-muted-foreground">
                          {log.metadata.cost.tokens?.prompt || 0} in /{' '}
                          {log.metadata.cost.tokens?.completion || 0} out
                        </span>
                      </div>
                    </div>

                    {isWorkflowWithCost && (
                      <div className="border-t bg-muted p-3 text-xs text-muted-foreground">
                        <p>
                          This is the total cost for all agent blocks in this workflow execution.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  )
}
