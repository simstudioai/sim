'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Eye, Loader2, X } from 'lucide-react'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-json'
import { Button, Tooltip } from '@/components/emcn'
import { CopyButton } from '@/components/ui/copy-button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { BASE_EXECUTION_CHARGE } from '@/lib/billing/constants'
import { FrozenCanvasModal } from '@/app/workspace/[workspaceId]/logs/components/frozen-canvas/frozen-canvas-modal'
import { FileDownload } from '@/app/workspace/[workspaceId]/logs/components/sidebar/components/file-download'
import LogMarkdownRenderer from '@/app/workspace/[workspaceId]/logs/components/sidebar/components/markdown-renderer'
import { ToolCallsDisplay } from '@/app/workspace/[workspaceId]/logs/components/tool-calls/tool-calls-display'
import { TraceSpans } from '@/app/workspace/[workspaceId]/logs/components/trace-spans/trace-spans'
import { formatDate } from '@/app/workspace/[workspaceId]/logs/utils'
import { formatCost } from '@/providers/utils'
import type { WorkflowLog } from '@/stores/logs/filters/types'
import '@/components/emcn/components/code/code.css'

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
    const trimmed = content.trim()
    if (
      !(trimmed.startsWith('{') || trimmed.startsWith('[')) ||
      !(trimmed.endsWith('}') || trimmed.endsWith(']'))
    ) {
      return { isJson: false, formatted: content }
    }

    const parsed = JSON.parse(trimmed)
    const prettified = JSON.stringify(parsed, null, 2)
    return { isJson: true, formatted: prettified }
  } catch (_e) {
    return { isJson: false, formatted: content }
  }
}

/**
 * Formats JSON content for display, handling multiple JSON objects separated by '--'
 */
const formatJsonContent = (content: string, blockInput?: Record<string, any>): React.ReactNode => {
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

  const { isJson, formatted } = tryPrettifyJson(content)

  return (
    <div className='group relative w-full rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F] p-3'>
      <CopyButton text={formatted} className='z-10 h-7 w-7' />
      {isJson ? (
        <div className='code-editor-theme'>
          <pre
            className='max-h-[500px] w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all font-mono text-[#eeeeee] text-[11px] leading-[16px]'
            dangerouslySetInnerHTML={{
              __html: highlight(formatted, languages.json, 'json'),
            }}
          />
        </div>
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

  const blockInputString = useMemo(() => {
    if (!blockInput) return undefined
    return JSON.stringify(blockInput, null, 2)
  }, [blockInput])

  const outputString = useMemo(() => {
    if (!isJson) return formatted

    try {
      const parsedOutput = JSON.parse(formatted)
      return JSON.stringify(parsedOutput, null, 2)
    } catch (_e) {
      return formatted
    }
  }, [formatted, isJson])

  return (
    <div className='w-full'>
      <div className='mb-2 font-medium text-muted-foreground text-sm'>{systemComment}</div>

      {/* Tabs for switching between output and input */}
      {blockInputString && (
        <div className='mb-2 flex space-x-1'>
          <button
            onClick={() => setActiveTab('output')}
            className={`px-3 py-1 text-xs transition-colors ${
              activeTab === 'output'
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-secondary/50'
            }`}
          >
            Output
          </button>
          <button
            onClick={() => setActiveTab('input')}
            className={`px-3 py-1 text-xs transition-colors ${
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
      <div className='group relative rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F] p-3'>
        {activeTab === 'output' ? (
          <>
            <CopyButton text={outputString} className='z-10 h-7 w-7' />
            {isJson ? (
              <div className='code-editor-theme'>
                <pre
                  className='w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all font-mono text-[#eeeeee] text-[11px] leading-[16px]'
                  dangerouslySetInnerHTML={{
                    __html: highlight(outputString, languages.json, 'json'),
                  }}
                />
              </div>
            ) : (
              <LogMarkdownRenderer content={outputString} />
            )}
          </>
        ) : blockInputString ? (
          <>
            <CopyButton text={blockInputString} className='z-10 h-7 w-7' />
            <div className='code-editor-theme'>
              <pre
                className='w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all font-mono text-[#eeeeee] text-[11px] leading-[16px]'
                dangerouslySetInnerHTML={{
                  __html: highlight(blockInputString, languages.json, 'json'),
                }}
              />
            </div>
          </>
        ) : null}
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
  const DEFAULT_WIDTH = 720
  const EXPANDED_WIDTH = 900

  const [width, setWidth] = useState(DEFAULT_WIDTH) // Start with default width
  const [isDragging, setIsDragging] = useState(false)
  const [_currentLogId, setCurrentLogId] = useState<string | null>(null)
  const [isTraceExpanded, setIsTraceExpanded] = useState(false)
  const [isModelsExpanded, setIsModelsExpanded] = useState(false)
  const [isFrozenCanvasOpen, setIsFrozenCanvasOpen] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Update currentLogId when log changes
  useEffect(() => {
    if (log?.id) {
      setCurrentLogId(log.id)
      // Reset trace expanded state when log changes
      setIsTraceExpanded(false)
    }
  }, [log?.id])

  const isLoadingDetails = useMemo(() => {
    if (!log) return false
    // Only show while we expect details to arrive (has executionId)
    if (!log.executionId) return false
    const hasEnhanced = !!log.executionData?.enhanced
    const hasAnyDetails = hasEnhanced || !!log.cost || Array.isArray(log.executionData?.traceSpans)
    return !hasAnyDetails
  }, [log])

  const formattedContent = useMemo(() => {
    if (!log) return null

    let blockInput: Record<string, any> | undefined

    if (log.executionData?.blockInput) {
      blockInput = log.executionData.blockInput
    } else if (log.executionData?.traceSpans) {
      const firstSpanWithInput = log.executionData.traceSpans.find((s) => s.input)
      if (firstSpanWithInput?.input) {
        blockInput = firstSpanWithInput.input as any
      }
    }

    return null
  }, [log])

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = 0
    }
  }, [log?.id])

  const isWorkflowExecutionLog = useMemo(() => {
    if (!log) return false
    return (
      (log.trigger === 'manual' && !!log.duration) ||
      (log.executionData?.enhanced && log.executionData?.traceSpans)
    )
  }, [log])

  const hasCostInfo = useMemo(() => {
    return isWorkflowExecutionLog && log?.cost
  }, [log, isWorkflowExecutionLog])

  const isWorkflowWithCost = useMemo(() => {
    return isWorkflowExecutionLog && hasCostInfo
  }, [isWorkflowExecutionLog, hasCostInfo])

  const handleTraceSpanToggle = (expanded: boolean) => {
    setIsTraceExpanded(expanded)

    if (expanded) {
      if (width < EXPANDED_WIDTH) {
        setWidth(EXPANDED_WIDTH)
      }
    } else {
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
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX
      const minWidthToUse = isTraceExpanded ? Math.max(MIN_WIDTH, EXPANDED_WIDTH) : MIN_WIDTH
      setWidth(Math.max(minWidthToUse, Math.min(newWidth, window.innerWidth * 0.8)))
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, isTraceExpanded])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }

      if (isOpen) {
        if (e.key === 'ArrowUp' && hasPrev && onNavigatePrev) {
          e.preventDefault()
          handleNavigate(onNavigatePrev)
        }

        if (e.key === 'ArrowDown' && hasNext && onNavigateNext) {
          e.preventDefault()
          handleNavigate(onNavigateNext)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, hasPrev, hasNext, onNavigatePrev, onNavigateNext])

  const handleNavigate = (navigateFunction: () => void) => {
    navigateFunction()
  }

  return (
    <div
      className={`fixed top-[94px] right-0 bottom-0 z-50 flex transform flex-col overflow-hidden border-l bg-[var(--surface-1)] dark:border-[var(--border)] dark:bg-[var(--surface-1)] ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      } ${isDragging ? '' : 'transition-all duration-300 ease-in-out'}`}
      style={{ width: `${width}px`, minWidth: `${MIN_WIDTH}px` }}
      aria-label='Log details sidebar'
    >
      {/* Resize Handle */}
      <div
        className='absolute top-0 bottom-0 left-[-4px] z-[60] w-[8px] cursor-ew-resize'
        onMouseDown={handleMouseDown}
        role='separator'
        aria-orientation='vertical'
        aria-label='Resize sidebar'
      />
      {log && (
        <>
          {/* Header */}
          <div className='flex items-center justify-between px-[8px] pt-[14px] pb-[14px]'>
            <h2 className='font-medium text-[15px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
              Log Details
            </h2>
            <div className='flex items-center gap-[4px]'>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    className='h-[32px] w-[32px] p-0'
                    onClick={() => hasPrev && handleNavigate(onNavigatePrev!)}
                    disabled={!hasPrev}
                    aria-label='Previous log'
                  >
                    <ChevronUp className='h-[14px] w-[14px]' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side='bottom'>Previous log</Tooltip.Content>
              </Tooltip.Root>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    className='h-[32px] w-[32px] p-0'
                    onClick={() => hasNext && handleNavigate(onNavigateNext!)}
                    disabled={!hasNext}
                    aria-label='Next log'
                  >
                    <ChevronDown className='h-[14px] w-[14px]' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side='bottom'>Next log</Tooltip.Content>
              </Tooltip.Root>

              <Button
                variant='ghost'
                className='h-[32px] w-[32px] p-0'
                onClick={onClose}
                aria-label='Close'
              >
                <X className='h-[14px] w-[14px]' />
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className='flex-1 overflow-hidden px-[8px]'>
            <ScrollArea className='h-full w-full overflow-y-auto' ref={scrollAreaRef}>
              <div className='w-full space-y-[16px] pr-[12px] pb-[16px]'>
                {/* Timestamp */}
                <div>
                  <h3 className='mb-[4px] font-medium text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                    Timestamp
                  </h3>
                  <div className='group relative text-[13px]'>
                    <CopyButton text={formatDate(log.createdAt).full} />
                    {formatDate(log.createdAt).full}
                  </div>
                </div>

                {/* Workflow */}
                {log.workflow && (
                  <div>
                    <h3 className='mb-[4px] font-medium text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                      Workflow
                    </h3>
                    <div className='group relative text-[13px]'>
                      <CopyButton text={log.workflow.name} />
                      <span
                        style={{
                          color: log.workflow.color,
                        }}
                      >
                        {log.workflow.name}
                      </span>
                    </div>
                  </div>
                )}

                {/* Execution ID */}
                {log.executionId && (
                  <div>
                    <h3 className='mb-[4px] font-medium text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                      Execution ID
                    </h3>
                    <div className='group relative break-all font-mono text-[13px]'>
                      <CopyButton text={log.executionId} />
                      {log.executionId}
                    </div>
                  </div>
                )}

                {/* Status */}
                <div>
                  <h3 className='mb-[4px] font-medium text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                    Status
                  </h3>
                  {(() => {
                    const baseLevel = (log.level || 'info').toLowerCase()
                    const isPending = log.duration == null
                    const statusLabel = isPending
                      ? 'Pending'
                      : `${baseLevel.charAt(0).toUpperCase()}${baseLevel.slice(1)}`
                    return (
                      <div className='group relative text-[13px] capitalize'>
                        <CopyButton text={statusLabel} />
                        {statusLabel}
                      </div>
                    )
                  })()}
                </div>

                {/* Trigger */}
                {log.trigger && (
                  <div>
                    <h3 className='mb-[4px] font-medium text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                      Trigger
                    </h3>
                    <div className='group relative text-[13px] capitalize'>
                      <CopyButton text={log.trigger} />
                      {log.trigger}
                    </div>
                  </div>
                )}

                {/* Duration */}
                {log.duration && (
                  <div>
                    <h3 className='mb-[4px] font-medium text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                      Duration
                    </h3>
                    <div className='group relative text-[13px]'>
                      <CopyButton text={log.duration} />
                      {log.duration}
                    </div>
                  </div>
                )}

                {/* Suspense while details load (positioned after summary fields) */}
                {isLoadingDetails && (
                  <div className='flex w-full items-center justify-start gap-[8px] py-[8px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
                    <Loader2 className='h-[16px] w-[16px] animate-spin' />
                    <span className='text-[13px]'>Loading details…</span>
                  </div>
                )}

                {/* Files */}
                {log.files && log.files.length > 0 && (
                  <div>
                    <h3 className='mb-[4px] font-medium text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                      Files ({log.files.length})
                    </h3>
                    <div className='space-y-[8px]'>
                      {log.files.map((file, index) => (
                        <div
                          key={file.id || index}
                          className='flex items-center justify-between border bg-muted/30 p-[8px] dark:border-[var(--border)]'
                        >
                          <div className='min-w-0 flex-1'>
                            <div className='truncate font-medium text-[13px]' title={file.name}>
                              {file.name}
                            </div>
                            <div className='text-[12px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
                              {file.size ? `${Math.round(file.size / 1024)}KB` : 'Unknown size'}
                              {file.type && ` • ${file.type.split('/')[0]}`}
                            </div>
                          </div>
                          <div className='ml-[8px] flex items-center gap-[4px]'>
                            <FileDownload file={file} isExecutionFile={true} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Frozen Canvas Button - only show for workflow execution logs with execution ID */}
                {isWorkflowExecutionLog && log.executionId && (
                  <div>
                    <h3 className='mb-[4px] font-medium text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                      Workflow State
                    </h3>
                    <Button
                      variant='ghost'
                      onClick={() => setIsFrozenCanvasOpen(true)}
                      className='h-8 w-full justify-start gap-[8px] border bg-muted/30 hover:bg-muted/50 dark:border-[var(--border)]'
                    >
                      <Eye className='h-[14px] w-[14px]' />
                      View Snapshot
                    </Button>
                    <p className='mt-[4px] text-[12px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
                      See the exact workflow state and block inputs/outputs at execution time
                    </p>
                  </div>
                )}

                {/* end suspense */}

                {/* Trace Spans (if available and this is a workflow execution log) */}
                {isWorkflowExecutionLog && log.executionData?.traceSpans && (
                  <div className='w-full'>
                    <div className='w-full overflow-x-hidden'>
                      <TraceSpans
                        traceSpans={log.executionData.traceSpans}
                        totalDuration={log.executionData.totalDuration}
                        onExpansionChange={handleTraceSpanToggle}
                      />
                    </div>
                  </div>
                )}

                {/* Tool Calls (if available) */}
                {log.executionData?.toolCalls && log.executionData.toolCalls.length > 0 && (
                  <div className='w-full'>
                    <h3 className='mb-[4px] font-medium text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                      Tool Calls
                    </h3>
                    <div className='w-full overflow-x-hidden bg-secondary/30 p-[12px]'>
                      <ToolCallsDisplay metadata={log.executionData} />
                    </div>
                  </div>
                )}

                {/* Cost Information (moved to bottom) */}
                {hasCostInfo && (
                  <div>
                    <h3 className='mb-[4px] font-medium text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                      Cost Breakdown
                    </h3>
                    <div className='overflow-hidden border dark:border-[var(--border)]'>
                      <div className='space-y-[8px] p-[12px]'>
                        <div className='flex items-center justify-between'>
                          <span className='text-[13px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
                            Base Execution:
                          </span>
                          <span className='text-[13px]'>{formatCost(BASE_EXECUTION_CHARGE)}</span>
                        </div>
                        <div className='flex items-center justify-between'>
                          <span className='text-[13px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
                            Model Input:
                          </span>
                          <span className='text-[13px]'>{formatCost(log.cost?.input || 0)}</span>
                        </div>
                        <div className='flex items-center justify-between'>
                          <span className='text-[13px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
                            Model Output:
                          </span>
                          <span className='text-[13px]'>{formatCost(log.cost?.output || 0)}</span>
                        </div>
                        <div className='mt-[4px] flex items-center justify-between border-t pt-[8px] dark:border-[var(--border)]'>
                          <span className='text-[13px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
                            Total:
                          </span>
                          <span className='text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                            {formatCost(log.cost?.total || 0)}
                          </span>
                        </div>
                        <div className='flex items-center justify-between'>
                          <span className='text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                            Tokens:
                          </span>
                          <span className='text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                            {log.cost?.tokens?.prompt || 0} in / {log.cost?.tokens?.completion || 0}{' '}
                            out
                          </span>
                        </div>
                      </div>

                      {/* Models Breakdown */}
                      {log.cost?.models && Object.keys(log.cost?.models).length > 0 && (
                        <div className='border-t dark:border-[var(--border)]'>
                          <button
                            onClick={() => setIsModelsExpanded(!isModelsExpanded)}
                            className='flex w-full items-center justify-between p-[12px] text-left transition-colors hover:bg-muted/50'
                          >
                            <span className='font-medium text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                              Model Breakdown ({Object.keys(log.cost?.models || {}).length})
                            </span>
                            {isModelsExpanded ? (
                              <ChevronUp className='h-[12px] w-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]' />
                            ) : (
                              <ChevronDown className='h-[12px] w-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]' />
                            )}
                          </button>

                          {isModelsExpanded && (
                            <div className='space-y-[12px] border-t bg-muted/30 p-[12px] dark:border-[var(--border)]'>
                              {Object.entries(log.cost?.models || {}).map(
                                ([model, cost]: [string, any]) => (
                                  <div key={model} className='space-y-[4px]'>
                                    <div className='font-medium font-mono text-[12px]'>{model}</div>
                                    <div className='space-y-[4px] text-[12px]'>
                                      <div className='flex justify-between'>
                                        <span className='text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
                                          Input:
                                        </span>
                                        <span>{formatCost(cost.input || 0)}</span>
                                      </div>
                                      <div className='flex justify-between'>
                                        <span className='text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
                                          Output:
                                        </span>
                                        <span>{formatCost(cost.output || 0)}</span>
                                      </div>
                                      <div className='flex justify-between border-t pt-[4px] dark:border-[var(--border)]'>
                                        <span className='text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
                                          Total:
                                        </span>
                                        <span className='font-medium'>
                                          {formatCost(cost.total || 0)}
                                        </span>
                                      </div>
                                      <div className='flex justify-between'>
                                        <span className='text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
                                          Tokens:
                                        </span>
                                        <span>
                                          {cost.tokens?.prompt || 0} in /{' '}
                                          {cost.tokens?.completion || 0} out
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                )
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {isWorkflowWithCost && (
                        <div className='border-t bg-muted p-[12px] text-[12px] text-[var(--text-secondary)] dark:border-[var(--border)] dark:text-[var(--text-secondary)]'>
                          <p>
                            Total cost includes a base execution charge of{' '}
                            {formatCost(BASE_EXECUTION_CHARGE)} plus any model usage costs.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </>
      )}

      {/* Frozen Canvas Modal */}
      {log?.executionId && (
        <FrozenCanvasModal
          executionId={log.executionId}
          workflowName={log.workflow?.name}
          trigger={log.trigger || undefined}
          traceSpans={log.executionData?.traceSpans}
          isOpen={isFrozenCanvasOpen}
          onClose={() => setIsFrozenCanvasOpen(false)}
        />
      )}
    </div>
  )
}
