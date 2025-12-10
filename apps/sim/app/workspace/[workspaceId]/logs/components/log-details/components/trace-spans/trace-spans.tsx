'use client'

import type React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-json'
import clsx from 'clsx'
import { Button, ChevronDown } from '@/components/emcn'
import type { TraceSpan } from '@/stores/logs/filters/types'
import '@/components/emcn/components/code/code.css'
import { LoopTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config'
import { ParallelTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config'
import { getBlock, getBlockByToolName } from '@/blocks'

interface TraceSpansProps {
  traceSpans?: TraceSpan[]
  totalDuration?: number
}

/**
 * Generates a unique key for a trace span
 */
function getSpanKey(span: TraceSpan): string {
  if (span.id) {
    return span.id
  }
  const name = span.name || 'span'
  const start = span.startTime || 'unknown-start'
  const end = span.endTime || 'unknown-end'
  return `${name}|${start}|${end}`
}

/**
 * Merges multiple arrays of trace span children, deduplicating by span key
 */
function mergeTraceSpanChildren(...groups: TraceSpan[][]): TraceSpan[] {
  const merged: TraceSpan[] = []
  const seen = new Set<string>()

  groups.forEach((group) => {
    group.forEach((child) => {
      const key = getSpanKey(child)
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      merged.push(child)
    })
  })

  return merged
}

/**
 * Normalizes a trace span by merging children from both the children array
 * and any childTraceSpans in the output
 */
function normalizeChildWorkflowSpan(span: TraceSpan): TraceSpan {
  const enrichedSpan: TraceSpan = { ...span }

  if (enrichedSpan.output && typeof enrichedSpan.output === 'object') {
    enrichedSpan.output = { ...enrichedSpan.output }
  }

  const normalizedChildren = Array.isArray(span.children)
    ? span.children.map((childSpan) => normalizeChildWorkflowSpan(childSpan))
    : []

  const outputChildSpans = Array.isArray(span.output?.childTraceSpans)
    ? (span.output!.childTraceSpans as TraceSpan[]).map((childSpan) =>
        normalizeChildWorkflowSpan(childSpan)
      )
    : []

  const mergedChildren = mergeTraceSpanChildren(normalizedChildren, outputChildSpans)

  if (
    enrichedSpan.output &&
    typeof enrichedSpan.output === 'object' &&
    enrichedSpan.output !== null &&
    'childTraceSpans' in enrichedSpan.output
  ) {
    const { childTraceSpans, ...cleanOutput } = enrichedSpan.output as {
      childTraceSpans?: TraceSpan[]
    } & Record<string, unknown>
    enrichedSpan.output = cleanOutput
  }

  enrichedSpan.children = mergedChildren.length > 0 ? mergedChildren : undefined

  return enrichedSpan
}

/**
 * Formats duration in ms
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/**
 * Gets color for block type
 */
function getBlockColor(type: string): string {
  switch (type.toLowerCase()) {
    case 'agent':
      return 'var(--brand-primary-hover-hex)'
    case 'model':
      return 'var(--brand-primary-hover-hex)'
    case 'function':
      return '#FF402F'
    case 'tool':
      return '#f97316'
    case 'router':
      return '#2FA1FF'
    case 'condition':
      return '#FF972F'
    case 'evaluator':
      return '#2FA1FF'
    case 'api':
      return '#2F55FF'
    default:
      return '#6b7280'
  }
}

/**
 * Gets icon and color for block type
 */
function getBlockIconAndColor(type: string): {
  icon: React.ComponentType<{ className?: string }> | null
  bgColor: string
} {
  const lowerType = type.toLowerCase()

  if (lowerType === 'loop') {
    return { icon: LoopTool.icon, bgColor: LoopTool.bgColor }
  }
  if (lowerType === 'parallel') {
    return { icon: ParallelTool.icon, bgColor: ParallelTool.bgColor }
  }

  const blockType = lowerType === 'model' ? 'agent' : lowerType
  const blockConfig = getBlock(blockType)
  if (blockConfig) {
    return { icon: blockConfig.icon, bgColor: blockConfig.bgColor }
  }

  return { icon: null, bgColor: getBlockColor(type) }
}

/**
 * Renders the progress bar showing execution timeline
 */
function ProgressBar({
  span,
  childSpans,
  workflowStartTime,
  totalDuration,
}: {
  span: TraceSpan
  childSpans?: TraceSpan[]
  workflowStartTime: number
  totalDuration: number
}) {
  const segments = useMemo(() => {
    if (!childSpans || childSpans.length === 0) {
      const startMs = new Date(span.startTime).getTime()
      const endMs = new Date(span.endTime).getTime()
      const duration = endMs - startMs
      const startPercent =
        totalDuration > 0 ? ((startMs - workflowStartTime) / totalDuration) * 100 : 0
      const widthPercent = totalDuration > 0 ? (duration / totalDuration) * 100 : 0

      let color = getBlockColor(span.type)
      if (span.type?.toLowerCase() === 'tool' && span.name) {
        const toolBlock = getBlockByToolName(span.name)
        if (toolBlock?.bgColor) {
          color = toolBlock.bgColor
        }
      }

      return [
        {
          startPercent: Math.max(0, Math.min(100, startPercent)),
          widthPercent: Math.max(0.5, Math.min(100, widthPercent)),
          color,
        },
      ]
    }

    return childSpans.map((child) => {
      const startMs = new Date(child.startTime).getTime()
      const endMs = new Date(child.endTime).getTime()
      const duration = endMs - startMs
      const startPercent =
        totalDuration > 0 ? ((startMs - workflowStartTime) / totalDuration) * 100 : 0
      const widthPercent = totalDuration > 0 ? (duration / totalDuration) * 100 : 0

      let color = getBlockColor(child.type)
      if (child.type?.toLowerCase() === 'tool' && child.name) {
        const toolBlock = getBlockByToolName(child.name)
        if (toolBlock?.bgColor) {
          color = toolBlock.bgColor
        }
      }

      return {
        startPercent: Math.max(0, Math.min(100, startPercent)),
        widthPercent: Math.max(0.5, Math.min(100, widthPercent)),
        color,
      }
    })
  }, [span, childSpans, workflowStartTime, totalDuration])

  return (
    <div className='relative mb-[8px] h-[5px] w-full overflow-hidden rounded-[18px] bg-[var(--divider)]'>
      {segments.map((segment, index) => (
        <div
          key={index}
          className='absolute h-full'
          style={{
            left: `${segment.startPercent}%`,
            width: `${segment.widthPercent}%`,
            backgroundColor: segment.color,
          }}
        />
      ))}
    </div>
  )
}

/**
 * Renders input/output section with collapsible content
 */
function InputOutputSection({
  label,
  data,
  isError,
  spanId,
  sectionType,
  expandedSections,
  onToggle,
}: {
  label: string
  data: unknown
  isError: boolean
  spanId: string
  sectionType: 'input' | 'output'
  expandedSections: Set<string>
  onToggle: (section: string) => void
}) {
  const sectionKey = `${spanId}-${sectionType}`
  const isExpanded = expandedSections.has(sectionKey)

  const jsonString = useMemo(() => {
    if (!data) return ''
    return JSON.stringify(data, null, 2)
  }, [data])

  const highlightedCode = useMemo(() => {
    if (!jsonString) return ''
    return highlight(jsonString, languages.json, 'json')
  }, [jsonString])

  return (
    <div className='flex flex-col gap-[8px]'>
      <div className='flex items-center justify-between'>
        <span
          className='font-medium text-[12px]'
          style={{ color: isError ? 'var(--text-error)' : 'var(--text-tertiary)' }}
        >
          {label}
        </span>
        <Button
          variant='ghost'
          className='!h-[18px] !w-[18px] !p-0'
          onClick={() => onToggle(sectionKey)}
        >
          <ChevronDown
            className='h-[10px] w-[10px] text-[var(--text-subtle)] transition-transform'
            style={{
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        </Button>
      </div>
      {isExpanded && (
        <div>
          {isError && typeof data === 'object' && data !== null && 'error' in data ? (
            <div
              className='rounded-[6px] px-[10px] py-[8px]'
              style={{
                backgroundColor: 'var(--terminal-status-error-bg)',
                color: 'var(--text-error)',
              }}
            >
              <div className='font-medium text-[12px]'>Error</div>
              <div className='mt-[4px] text-[12px]'>{(data as { error: string }).error}</div>
            </div>
          ) : (
            <div className='code-editor-theme overflow-hidden rounded-[6px] bg-[var(--surface-3)] px-[10px] py-[8px]'>
              <pre
                className='m-0 w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all font-mono text-[#eeeeee] text-[11px] leading-[16px]'
                dangerouslySetInnerHTML={{ __html: highlightedCode }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface TraceSpanItemProps {
  span: TraceSpan
  totalDuration: number
  workflowStartTime: number
  onToggle: (spanId: string, expanded: boolean) => void
  expandedSpans: Set<string>
  isFirstSpan?: boolean
}

/**
 * Individual trace span card component
 */
function TraceSpanItem({
  span,
  totalDuration,
  workflowStartTime,
  onToggle,
  expandedSpans,
  isFirstSpan = false,
}: TraceSpanItemProps): React.ReactNode {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  const spanId = span.id || `span-${span.name}-${span.startTime}`
  const spanStartTime = new Date(span.startTime).getTime()
  const spanEndTime = new Date(span.endTime).getTime()
  const duration = span.duration || spanEndTime - spanStartTime

  const hasChildren = span.children && span.children.length > 0
  const hasToolCalls = span.toolCalls && span.toolCalls.length > 0
  const hasInput = Boolean(span.input)
  const hasOutput = Boolean(span.output)
  const isError = span.status === 'error'

  const inlineChildTypes = new Set(['tool', 'model'])
  const inlineChildren =
    span.children?.filter((child) => inlineChildTypes.has(child.type?.toLowerCase() || '')) || []
  const otherChildren =
    span.children?.filter((child) => !inlineChildTypes.has(child.type?.toLowerCase() || '')) || []

  const toolCallSpans = useMemo(() => {
    if (!hasToolCalls) return []
    return span.toolCalls!.map((toolCall, index) => {
      const toolStartTime = toolCall.startTime
        ? new Date(toolCall.startTime).getTime()
        : spanStartTime
      const toolEndTime = toolCall.endTime
        ? new Date(toolCall.endTime).getTime()
        : toolStartTime + (toolCall.duration || 0)

      return {
        id: `${spanId}-tool-${index}`,
        name: toolCall.name,
        type: 'tool',
        duration: toolCall.duration || toolEndTime - toolStartTime,
        startTime: new Date(toolStartTime).toISOString(),
        endTime: new Date(toolEndTime).toISOString(),
        status: toolCall.error ? ('error' as const) : ('success' as const),
        input: toolCall.input,
        output: toolCall.error
          ? { error: toolCall.error, ...(toolCall.output || {}) }
          : toolCall.output,
      } as TraceSpan
    })
  }, [hasToolCalls, span.toolCalls, spanId, spanStartTime])

  const handleSectionToggle = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  const { icon: BlockIcon, bgColor } = getBlockIconAndColor(span.type)

  return (
    <>
      <div className='flex flex-col gap-[8px] rounded-[6px] bg-[var(--surface-1)] px-[10px] py-[8px]'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[8px]'>
            {!isFirstSpan && (
              <div
                className='relative flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
                style={{ background: bgColor }}
              >
                {BlockIcon && <BlockIcon className={clsx('text-white', '!h-[9px] !w-[9px]')} />}
              </div>
            )}
            <span
              className='font-medium text-[12px]'
              style={{ color: isError ? 'var(--text-error)' : 'var(--text-secondary)' }}
            >
              {span.name}
            </span>
          </div>
          <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
            {formatDuration(duration)}
          </span>
        </div>

        <ProgressBar
          span={span}
          childSpans={span.children}
          workflowStartTime={workflowStartTime}
          totalDuration={totalDuration}
        />

        {hasInput && (
          <InputOutputSection
            label='Input'
            data={span.input}
            isError={false}
            spanId={spanId}
            sectionType='input'
            expandedSections={expandedSections}
            onToggle={handleSectionToggle}
          />
        )}

        {hasInput && hasOutput && <div className='border-[var(--border)] border-t border-dashed' />}

        {hasOutput && (
          <InputOutputSection
            label={isError ? 'Error' : 'Output'}
            data={span.output}
            isError={isError}
            spanId={spanId}
            sectionType='output'
            expandedSections={expandedSections}
            onToggle={handleSectionToggle}
          />
        )}

        {(hasToolCalls || inlineChildren.length > 0) &&
          [...toolCallSpans, ...inlineChildren].map((childSpan, index) => {
            const childId = childSpan.id || `${spanId}-inline-${index}`
            const childIsError = childSpan.status === 'error'
            const isInitialResponse = (childSpan.name || '')
              .toLowerCase()
              .includes('initial response')

            const shouldRenderSeparator =
              index === 0 && (hasInput || hasOutput) && !isInitialResponse

            const toolBlock =
              childSpan.type?.toLowerCase() === 'tool' && childSpan.name
                ? getBlockByToolName(childSpan.name)
                : null
            const { icon: ChildIcon, bgColor: childBgColor } = toolBlock
              ? { icon: toolBlock.icon, bgColor: toolBlock.bgColor }
              : getBlockIconAndColor(childSpan.type)

            return (
              <div key={`inline-${childId}`}>
                {shouldRenderSeparator && (
                  <div className='border-[var(--border)] border-t border-dashed' />
                )}

                <div className='mt-[8px] flex flex-col gap-[8px]'>
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-[8px]'>
                      <div
                        className='relative flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
                        style={{ background: childBgColor }}
                      >
                        {ChildIcon && (
                          <ChildIcon className={clsx('text-white', '!h-[9px] !w-[9px]')} />
                        )}
                      </div>
                      <span
                        className='font-medium text-[12px]'
                        style={{
                          color: childIsError ? 'var(--text-error)' : 'var(--text-secondary)',
                        }}
                      >
                        {childSpan.name}
                      </span>
                    </div>
                    <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
                      {formatDuration(childSpan.duration || 0)}
                    </span>
                  </div>

                  <ProgressBar
                    span={childSpan}
                    childSpans={undefined}
                    workflowStartTime={workflowStartTime}
                    totalDuration={totalDuration}
                  />

                  {childSpan.input && (
                    <InputOutputSection
                      label='Input'
                      data={childSpan.input}
                      isError={false}
                      spanId={`${childId}-input`}
                      sectionType='input'
                      expandedSections={expandedSections}
                      onToggle={handleSectionToggle}
                    />
                  )}

                  {childSpan.input && childSpan.output && (
                    <div className='border-[var(--border)] border-t border-dashed' />
                  )}

                  {childSpan.output && (
                    <InputOutputSection
                      label={childIsError ? 'Error' : 'Output'}
                      data={childSpan.output}
                      isError={childIsError}
                      spanId={`${childId}-output`}
                      sectionType='output'
                      expandedSections={expandedSections}
                      onToggle={handleSectionToggle}
                    />
                  )}
                </div>
              </div>
            )
          })}
      </div>

      {otherChildren.map((childSpan, index) => {
        const enrichedChildSpan = normalizeChildWorkflowSpan(childSpan)
        return (
          <TraceSpanItem
            key={index}
            span={enrichedChildSpan}
            totalDuration={totalDuration}
            workflowStartTime={workflowStartTime}
            onToggle={onToggle}
            expandedSpans={expandedSpans}
            isFirstSpan={false}
          />
        )
      })}
    </>
  )
}

/**
 * Displays workflow execution trace spans with nested structure
 */
export function TraceSpans({ traceSpans, totalDuration = 0 }: TraceSpansProps) {
  const [expandedSpans, setExpandedSpans] = useState<Set<string>>(new Set())

  const workflowStartTime = useMemo(() => {
    if (!traceSpans || traceSpans.length === 0) return 0
    return traceSpans.reduce((earliest, span) => {
      const startTime = new Date(span.startTime).getTime()
      return startTime < earliest ? startTime : earliest
    }, Number.POSITIVE_INFINITY)
  }, [traceSpans])

  const workflowEndTime = useMemo(() => {
    if (!traceSpans || traceSpans.length === 0) return 0
    return traceSpans.reduce((latest, span) => {
      const endTime = span.endTime ? new Date(span.endTime).getTime() : 0
      return endTime > latest ? endTime : latest
    }, 0)
  }, [traceSpans])

  const actualTotalDuration = workflowEndTime - workflowStartTime

  const handleSpanToggle = useCallback((spanId: string, expanded: boolean) => {
    setExpandedSpans((prev) => {
      const newExpandedSpans = new Set(prev)
      if (expanded) {
        newExpandedSpans.add(spanId)
      } else {
        newExpandedSpans.delete(spanId)
      }
      return newExpandedSpans
    })
  }, [])

  const filtered = useMemo(() => {
    const filterTree = (spans: TraceSpan[]): TraceSpan[] =>
      spans
        .map((s) => normalizeChildWorkflowSpan(s))
        .map((s) => ({
          ...s,
          children: s.children ? filterTree(s.children) : undefined,
        }))
    return traceSpans ? filterTree(traceSpans) : []
  }, [traceSpans])

  if (!traceSpans || traceSpans.length === 0) {
    return <div className='text-[12px] text-[var(--text-secondary)]'>No trace data available</div>
  }

  return (
    <div className='flex w-full flex-col gap-[6px] rounded-[6px] bg-[var(--surface-2)] px-[10px] py-[8px]'>
      <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>Trace Span</span>
      <div className='flex flex-col gap-[8px]'>
        {filtered.map((span, index) => (
          <TraceSpanItem
            key={index}
            span={span}
            totalDuration={actualTotalDuration !== undefined ? actualTotalDuration : totalDuration}
            workflowStartTime={workflowStartTime}
            onToggle={handleSpanToggle}
            expandedSpans={expandedSpans}
            isFirstSpan={index === 0}
          />
        ))}
      </div>
    </div>
  )
}
