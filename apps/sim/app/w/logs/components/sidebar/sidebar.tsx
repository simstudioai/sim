'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { redactApiKeys } from '@/lib/utils'
import type { WorkflowLog } from '@/app/w/logs/stores/types'
import { formatDate } from '@/app/w/logs/utils/format-date'
import { formatCost } from '@/providers/utils'
import { ToolCallsDisplay } from '../tool-calls/tool-calls-display'
import { TraceSpansDisplay } from '../trace-spans/trace-spans-display'
import LogMarkdownRenderer from './components/markdown-renderer'

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
 * Tries to parse a string as JSON and prettify it
 */
const tryPrettifyJson = (content: string): { isJson: boolean; formatted: string } => {
  try {
    // First check if the content looks like JSON (starts with { or [)
    const trimmed = content.trim()
    if (
      !(trimmed.startsWith('{') || trimmed.startsWith('[')) ||
      !(trimmed.endsWith('}') || trimmed.endsWith(']'))
    ) {
      return { isJson: false, formatted: content }
    }

    // Try to parse the JSON
    const parsed = JSON.parse(trimmed)
    const prettified = JSON.stringify(parsed, null, 2)
    return { isJson: true, formatted: prettified }
  } catch (_e) {
    // If parsing fails, it's not valid JSON
    return { isJson: false, formatted: content }
  }
}

/**
 * Formats JSON content for display, handling multiple JSON objects separated by '--'
 */
const formatJsonContent = (content: string, blockInput?: Record<string, any>): React.ReactNode => {
  // Look for a pattern like "Block Agent 1 (agent):" to separate system comment from content
  const blockPattern = /^(Block .+?\(.+?\):)\s*/
  const match = content.match(blockPattern)

  if (match) {
    const systemComment = match[1]
    const actualContent = content.substring(match[0].length).trim()
    const { isJson, formatted } = tryPrettifyJson(actualContent)

    return (
      <BlockContentDisplay
        systemComment={systemComment}
        formatted={formatted}
        isJson={isJson}
        blockInput={blockInput}
      />
    )
  }

  // If no system comment pattern found, show the whole content
  const { isJson, formatted } = tryPrettifyJson(content)

  return (
    <div className='group relative w-full rounded-md bg-secondary/30 p-3'>
      <CopyButton text={formatted} className='z-10 h-7 w-7' />
      {isJson ? (
        <pre className='max-h-[500px] w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all text-sm'>
          {formatted}
        </pre>
      ) : (
        <LogMarkdownRenderer content={formatted} />
      )}
    </div>
  )
}

const BlockContentDisplay = ({
  systemComment,
  formatted,
  isJson,
  blockInput,
}: {
  systemComment: string
  formatted: string
  isJson: boolean
  blockInput?: Record<string, any>
}) => {
  const [activeTab, setActiveTab] = useState<'output' | 'input'>(blockInput ? 'output' : 'output')

  const redactedBlockInput = useMemo(() => {
    return blockInput ? redactApiKeys(blockInput) : undefined
  }, [blockInput])

  const redactedOutput = useMemo(() => {
    if (!isJson) return formatted

    try {
      const parsedOutput = JSON.parse(formatted)
      const redactedJson = redactApiKeys(parsedOutput)
      return JSON.stringify(redactedJson, null, 2)
    } catch (_e) {
      return formatted
    }
  }, [formatted, isJson])

  return (
    <div className='w-full'>
      <div className='mb-2 font-medium text-muted-foreground text-sm'>{systemComment}</div>

      {/* Tabs for switching between output and input */}
      {redactedBlockInput && (
        <div className='mb-2 flex space-x-1'>
          <button
            onClick={() => setActiveTab('output')}
            className={`rounded-md px-3 py-1 text-xs transition-colors ${
              activeTab === 'output'
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-secondary/50'
            }`}
          >
            Output
          </button>
          <button
            onClick={() => setActiveTab('input')}
            className={`rounded-md px-3 py-1 text-xs transition-colors ${
              activeTab === 'input'
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-secondary/50'
            }`}
          >
            Input
          </button>
        </div>
      )}

      {/* Content based on active tab */}
      <div className='group relative rounded-md bg-secondary/30 p-3'>
        {activeTab === 'output' ? (
          <>
            <CopyButton text={redactedOutput} className='z-10 h-7 w-7' />
            {isJson ? (
              <pre className='w-full overflow-visible whitespace-pre-wrap break-all text-sm'>
                {redactedOutput}
              </pre>
            ) : (
              <LogMarkdownRenderer content={redactedOutput} />
            )}
          </>
        ) : (
          <>
            <CopyButton
              text={JSON.stringify(redactedBlockInput, null, 2)}
              className='z-10 h-7 w-7'
            />
            <pre className='w-full overflow-visible whitespace-pre-wrap break-all text-sm'>
              {JSON.stringify(redactedBlockInput, null, 2)}
            </pre>
          </>
        )}
      </div>
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
  const DEFAULT_WIDTH = 600
  const EXPANDED_WIDTH = 800

  const [width, setWidth] = useState(DEFAULT_WIDTH) // Start with default width
  const [isDragging, setIsDragging] = useState(false)
  const [_currentLogId, setCurrentLogId] = useState<string | null>(null)
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

    let blockInput: Record<string, any> | undefined

    if (log.metadata?.blockInput) {
      blockInput = log.metadata.blockInput
    } else if (log.metadata?.traceSpans) {
      const blockIdMatch = log.message.match(/Block .+?(\d+)/i)
      const blockId = blockIdMatch ? blockIdMatch[1] : null

      if (blockId) {
        const matchingSpan = log.metadata.traceSpans.find(
          (span) => span.blockId === blockId || span.name.includes(`Block ${blockId}`)
        )

        if (matchingSpan?.input) {
          blockInput = matchingSpan.input
        }
      }
    }

    return formatJsonContent(log.message, blockInput)
  }, [log])

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
  const _hasTraceSpans = useMemo(() => {
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
      className={`fixed inset-y-0 right-0 transform border-l bg-background ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      } ${isDragging ? '' : 'transition-all duration-300 ease-in-out'} z-50 flex flex-col`}
      style={{ top: '64px', width: `${width}px`, minWidth: `${MIN_WIDTH}px` }}
    >
      <div
        className='absolute top-0 bottom-0 left-[-4px] z-50 w-4 cursor-ew-resize hover:bg-accent/50'
        onMouseDown={handleMouseDown}
      />
      {log && (
        <>
          {/* Header */}
          <div className='flex flex-shrink-0 items-center justify-between border-b px-4 py-3'>
            <h2 className='font-medium text-base'>Log Details</h2>
            <div className='flex items-center space-x-1'>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-8 w-8 p-0'
                      onClick={() => hasPrev && handleNavigate(onNavigatePrev!)}
                      disabled={!hasPrev}
                      aria-label='Previous log'
                    >
                      <ChevronUp className='h-4 w-4' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side='bottom'>Previous log (↑)</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-8 w-8 p-0'
                      onClick={() => hasNext && handleNavigate(onNavigateNext!)}
                      disabled={!hasNext}
                      aria-label='Next log'
                    >
                      <ChevronDown className='h-4 w-4' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side='bottom'>Next log (↓)</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8 p-0'
                onClick={onClose}
                aria-label='Close'
              >
                <X className='h-4 w-4' />
              </Button>
            </div>
          </div>

          {/* Content */}
          <ScrollArea
            className='h-[calc(100vh-64px-49px)] w-full overflow-y-auto'
            ref={scrollAreaRef}
          >
            <div className='w-full space-y-4 p-4 pr-6'>
              {/* Timestamp */}
              <div>
                <h3 className='mb-1 font-medium text-muted-foreground text-xs'>Timestamp</h3>
                <div className='group relative text-sm'>
                  <CopyButton text={formatDate(log.createdAt).full} />
                  {formatDate(log.createdAt).full}
                </div>
              </div>

              {/* Workflow */}
              {log.workflow && (
                <div>
                  <h3 className='mb-1 font-medium text-muted-foreground text-xs'>Workflow</h3>
                  <div
                    className='group relative text-sm'
                    style={{
                      color: log.workflow.color,
                    }}
                  >
                    <CopyButton text={log.workflow.name} />
                    <div
                      className='inline-flex items-center rounded-md px-2 py-1 text-xs'
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
                  <h3 className='mb-1 font-medium text-muted-foreground text-xs'>Execution ID</h3>
                  <div className='group relative break-all font-mono text-sm'>
                    <CopyButton text={log.executionId} />
                    {log.executionId}
                  </div>
                </div>
              )}

              {/* Level */}
              <div>
                <h3 className='mb-1 font-medium text-muted-foreground text-xs'>Level</h3>
                <div className='group relative text-sm capitalize'>
                  <CopyButton text={log.level} />
                  {log.level}
                </div>
              </div>

              {/* Trigger */}
              {log.trigger && (
                <div>
                  <h3 className='mb-1 font-medium text-muted-foreground text-xs'>Trigger</h3>
                  <div className='group relative text-sm capitalize'>
                    <CopyButton text={log.trigger} />
                    {log.trigger}
                  </div>
                </div>
              )}

              {/* Duration */}
              {log.duration && (
                <div>
                  <h3 className='mb-1 font-medium text-muted-foreground text-xs'>Duration</h3>
                  <div className='group relative text-sm'>
                    <CopyButton text={log.duration} />
                    {log.duration}
                  </div>
                </div>
              )}

              {/* Message Content */}
              <div className='w-full pb-2'>
                <h3 className='mb-1 font-medium text-muted-foreground text-xs'>Message</h3>
                <div className='w-full'>{formattedContent}</div>
              </div>

              {/* Trace Spans (if available and this is a workflow execution log) */}
              {isWorkflowExecutionLog && log.metadata?.traceSpans && (
                <div className='w-full'>
                  <div className='w-full overflow-x-hidden'>
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
                <div className='w-full'>
                  <h3 className='mb-1 font-medium text-muted-foreground text-xs'>Tool Calls</h3>
                  <div className='w-full overflow-x-hidden rounded-md bg-secondary/30 p-3'>
                    <ToolCallsDisplay metadata={log.metadata} />
                  </div>
                </div>
              )}

              {/* Cost Information (moved to bottom) */}
              {hasCostInfo && log.metadata?.cost && (
                <div>
                  <h3 className='mb-1 font-medium text-muted-foreground text-xs'>
                    {isWorkflowWithCost ? 'Total Model Cost' : 'Model Cost'}
                  </h3>
                  <div className='overflow-hidden rounded-md border'>
                    <div className='space-y-2 p-3'>
                      {log.metadata.cost.model && (
                        <div className='flex items-center justify-between'>
                          <span className='text-muted-foreground text-sm'>Model:</span>
                          <span className='text-sm'>{log.metadata.cost.model}</span>
                        </div>
                      )}
                      <div className='flex items-center justify-between'>
                        <span className='text-muted-foreground text-sm'>Input:</span>
                        <span className='text-sm'>{formatCost(log.metadata.cost.input || 0)}</span>
                      </div>
                      <div className='flex items-center justify-between'>
                        <span className='text-muted-foreground text-sm'>Output:</span>
                        <span className='text-sm'>{formatCost(log.metadata.cost.output || 0)}</span>
                      </div>
                      <div className='mt-1 flex items-center justify-between border-t pt-2'>
                        <span className='text-muted-foreground text-sm'>Total:</span>
                        <span className='text-foreground text-sm'>
                          {formatCost(log.metadata.cost.total || 0)}
                        </span>
                      </div>
                      <div className='flex items-center justify-between'>
                        <span className='text-muted-foreground text-xs'>Tokens:</span>
                        <span className='text-muted-foreground text-xs'>
                          {log.metadata.cost.tokens?.prompt || 0} in /{' '}
                          {log.metadata.cost.tokens?.completion || 0} out
                        </span>
                      </div>
                    </div>

                    {isWorkflowWithCost && (
                      <div className='border-t bg-muted p-3 text-muted-foreground text-xs'>
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
