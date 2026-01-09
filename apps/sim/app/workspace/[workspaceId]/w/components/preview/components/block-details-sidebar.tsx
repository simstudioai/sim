'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown as ChevronDownIcon,
  ChevronUp,
  RepeatIcon,
  SplitIcon,
  X,
} from 'lucide-react'
import { ReactFlowProvider } from 'reactflow'
import { Badge, Button, ChevronDown, Code, Combobox, Input, Label } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { extractReferencePrefixes } from '@/lib/workflows/sanitization/references'
import { SnapshotContextMenu } from '@/app/workspace/[workspaceId]/logs/components/log-details/components/execution-snapshot/components'
import { SubBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { getBlock } from '@/blocks'
import type { BlockConfig, BlockIcon, SubBlockConfig } from '@/blocks/types'
import { normalizeName } from '@/executor/constants'
import { navigatePath } from '@/executor/variables/resolvers/reference'
import { useCodeViewerFeatures } from '@/hooks/use-code-viewer'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'

/**
 * Evaluate whether a subblock's condition is met based on current values.
 */
function evaluateCondition(
  condition: SubBlockConfig['condition'],
  subBlockValues: Record<string, { value: unknown } | unknown>
): boolean {
  if (!condition) return true

  const actualCondition = typeof condition === 'function' ? condition() : condition

  const fieldValueObj = subBlockValues[actualCondition.field]
  const fieldValue =
    fieldValueObj && typeof fieldValueObj === 'object' && 'value' in fieldValueObj
      ? (fieldValueObj as { value: unknown }).value
      : fieldValueObj

  const conditionValues = Array.isArray(actualCondition.value)
    ? actualCondition.value
    : [actualCondition.value]

  let isMatch = conditionValues.some((v) => v === fieldValue)

  if (actualCondition.not) {
    isMatch = !isMatch
  }

  if (actualCondition.and && isMatch) {
    const andFieldValueObj = subBlockValues[actualCondition.and.field]
    const andFieldValue =
      andFieldValueObj && typeof andFieldValueObj === 'object' && 'value' in andFieldValueObj
        ? (andFieldValueObj as { value: unknown }).value
        : andFieldValueObj

    const andConditionValues = Array.isArray(actualCondition.and.value)
      ? actualCondition.and.value
      : [actualCondition.and.value]

    let andMatch = andConditionValues.some((v) => v === andFieldValue)

    if (actualCondition.and.not) {
      andMatch = !andMatch
    }

    isMatch = isMatch && andMatch
  }

  return isMatch
}

/**
 * Format a value for display as JSON string
 */
function formatValueAsJson(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—'
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

interface ResolvedConnection {
  blockId: string
  blockName: string
  blockType: string
  fields: Array<{ path: string; value: string; tag: string }>
}

interface ExtractedReferences {
  blockRefs: string[]
  workflowVars: string[]
  envVars: string[]
}

/**
 * Extract all variable references from nested subblock values
 */
function extractAllReferencesFromSubBlocks(
  subBlockValues: Record<string, unknown>
): ExtractedReferences {
  const blockRefs = new Set<string>()
  const workflowVars = new Set<string>()
  const envVars = new Set<string>()

  const processValue = (value: unknown) => {
    if (typeof value === 'string') {
      const extracted = extractReferencePrefixes(value)
      for (const ref of extracted) {
        if (ref.prefix === 'variable') {
          workflowVars.add(ref.raw)
        } else {
          blockRefs.add(ref.raw)
        }
      }

      const envMatches = value.match(/\{\{([^}]+)\}\}/g)
      if (envMatches) {
        envMatches.forEach((match) => envVars.add(match))
      }
    } else if (Array.isArray(value)) {
      value.forEach(processValue)
    } else if (value && typeof value === 'object') {
      if ('value' in value) {
        processValue((value as { value: unknown }).value)
      } else {
        Object.values(value).forEach(processValue)
      }
    }
  }

  Object.values(subBlockValues).forEach(processValue)
  return {
    blockRefs: Array.from(blockRefs),
    workflowVars: Array.from(workflowVars),
    envVars: Array.from(envVars),
  }
}

/**
 * Format a value for inline display (single line, truncated)
 */
function formatInlineValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

interface ExecutionDataSectionProps {
  title: string
  data: unknown
  isError?: boolean
  wrapText?: boolean
  searchQuery?: string
  currentMatchIndex?: number
  onMatchCountChange?: (count: number) => void
  contentRef?: React.RefObject<HTMLDivElement | null>
  onContextMenu?: (e: React.MouseEvent) => void
}

/**
 * Collapsible section for execution data (input/output)
 * Uses Code.Viewer for proper syntax highlighting matching the logs UI
 */
function ExecutionDataSection({
  title,
  data,
  isError = false,
  wrapText = true,
  searchQuery,
  currentMatchIndex = 0,
  onMatchCountChange,
  contentRef,
  onContextMenu,
}: ExecutionDataSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const jsonString = useMemo(() => {
    if (!data) return ''
    return formatValueAsJson(data)
  }, [data])

  const isEmpty = jsonString === '—' || jsonString === ''

  return (
    <div className='flex min-w-0 flex-col gap-[8px] overflow-hidden'>
      <div
        className='group flex cursor-pointer items-center justify-between'
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setIsExpanded(!isExpanded)
          }
        }}
        role='button'
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${title.toLowerCase()}`}
      >
        <span
          className={cn(
            'font-medium text-[12px] transition-colors',
            isError
              ? 'text-[var(--text-error)]'
              : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]'
          )}
        >
          {title}
        </span>
        <ChevronDown
          className={cn(
            'h-[10px] w-[10px] text-[var(--text-tertiary)] transition-colors transition-transform group-hover:text-[var(--text-primary)]'
          )}
          style={{
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </div>

      {isExpanded && (
        <>
          {isEmpty ? (
            <div className='rounded-[6px] bg-[var(--surface-3)] px-[10px] py-[8px]'>
              <span className='text-[12px] text-[var(--text-tertiary)]'>No data</span>
            </div>
          ) : (
            <div onContextMenu={onContextMenu} ref={contentRef}>
              <Code.Viewer
                code={jsonString}
                language='json'
                className='!bg-[var(--surface-3)] max-h-[300px] min-h-0 max-w-full rounded-[6px] border-0 [word-break:break-all]'
                wrapText={wrapText}
                searchQuery={searchQuery}
                currentMatchIndex={currentMatchIndex}
                onMatchCountChange={onMatchCountChange}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface ResolvedVariable {
  ref: string
  name: string
  value: string
}

interface ConnectionsSectionProps {
  connections: ResolvedConnection[]
  workflowVars: ResolvedVariable[]
  envVars: ResolvedVariable[]
  onContextMenu?: (e: React.MouseEvent, value: string) => void
  /** Height of the connections section */
  height: number
  /** Whether the section is being resized */
  isResizing: boolean
  /** Whether the connections are at minimum height (collapsed) */
  isAtMinHeight: boolean
  /** Handler for resize mouse down */
  onResizeMouseDown: (e: React.MouseEvent) => void
  /** Handler for toggling collapsed state */
  onToggleCollapsed: () => void
}

/**
 * Section showing resolved variable references - styled like the connections section in editor
 */
function ConnectionsSection({
  connections,
  workflowVars,
  envVars,
  onContextMenu,
  height,
  isResizing,
  isAtMinHeight,
  onResizeMouseDown,
  onToggleCollapsed,
}: ConnectionsSectionProps) {
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set())
  const [expandedVariables, setExpandedVariables] = useState(true)
  const [expandedEnvVars, setExpandedEnvVars] = useState(true)

  useEffect(() => {
    setExpandedBlocks(new Set(connections.map((c) => c.blockId)))
  }, [connections])

  const hasContent = connections.length > 0 || workflowVars.length > 0 || envVars.length > 0

  if (!hasContent) return null

  const toggleBlock = (blockId: string) => {
    setExpandedBlocks((prev) => {
      const next = new Set(prev)
      if (next.has(blockId)) {
        next.delete(blockId)
      } else {
        next.add(blockId)
      }
      return next
    })
  }

  const handleValueContextMenu = (e: React.MouseEvent, value: string) => {
    if (value && value !== '—' && value !== '[REDACTED]' && onContextMenu) {
      onContextMenu(e, value)
    }
  }

  return (
    <div
      className={cn(
        'flex flex-shrink-0 flex-col overflow-hidden border-[var(--border)] border-t',
        !isResizing && 'transition-[height] duration-100 ease-out'
      )}
      style={{ height: `${height}px` }}
    >
      {/* Resize Handle */}
      <div className='relative'>
        <div
          className='absolute top-[-4px] right-0 left-0 z-30 h-[8px] cursor-ns-resize'
          onMouseDown={onResizeMouseDown}
        />
      </div>

      {/* Header with Chevron */}
      <div
        className='flex flex-shrink-0 cursor-pointer items-center gap-[8px] px-[10px] pt-[5px] pb-[5px]'
        onClick={onToggleCollapsed}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggleCollapsed()
          }
        }}
        role='button'
        tabIndex={0}
        aria-label={isAtMinHeight ? 'Expand connections' : 'Collapse connections'}
      >
        <ChevronUp
          className={cn('h-[14px] w-[14px] transition-transform', !isAtMinHeight && 'rotate-180')}
        />
        <div className='font-medium text-[13px] text-[var(--text-primary)]'>Connections</div>
      </div>

      {/* Content - styled like ConnectionBlocks */}
      <div className='flex-1 space-y-[2px] overflow-y-auto overflow-x-hidden px-[6px] pb-[8px]'>
        {connections.map((connection) => {
          const blockConfig = getBlock(connection.blockType)
          const Icon = blockConfig?.icon
          const bgColor = blockConfig?.bgColor || '#6B7280'
          const isExpanded = expandedBlocks.has(connection.blockId)
          const hasFields = connection.fields.length > 0

          return (
            <div key={connection.blockId} className='mb-[2px] last:mb-0'>
              {/* Block header - styled like ConnectionItem */}
              <div
                className={cn(
                  'group flex h-[26px] items-center gap-[8px] rounded-[8px] px-[6px] text-[14px] hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]',
                  hasFields && 'cursor-pointer'
                )}
                onClick={() => hasFields && toggleBlock(connection.blockId)}
              >
                <div
                  className='relative flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
                  style={{ background: bgColor }}
                >
                  {Icon && (
                    <Icon
                      className={cn(
                        'text-white transition-transform duration-200',
                        hasFields && 'group-hover:scale-110',
                        '!h-[9px] !w-[9px]'
                      )}
                    />
                  )}
                </div>
                <span
                  className={cn(
                    'truncate font-medium',
                    'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'
                  )}
                >
                  {connection.blockName}
                </span>
                {hasFields && (
                  <ChevronDownIcon
                    className={cn(
                      'h-3.5 w-3.5 flex-shrink-0 transition-transform duration-100',
                      'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]',
                      isExpanded && 'rotate-180'
                    )}
                  />
                )}
              </div>

              {/* Fields - styled like FieldItem but showing resolved values */}
              {isExpanded && hasFields && (
                <div className='relative mt-[2px] ml-[12px] space-y-[2px] pl-[10px]'>
                  <div className='pointer-events-none absolute top-[4px] bottom-[4px] left-0 w-px bg-[var(--border)]' />
                  {connection.fields.map((field) => (
                    <div
                      key={field.tag}
                      className='group flex min-h-[26px] flex-wrap items-baseline gap-x-[8px] gap-y-[2px] rounded-[8px] px-[6px] py-[4px] text-[14px] hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]'
                      onContextMenu={(e) => handleValueContextMenu(e, field.value)}
                    >
                      <span
                        className={cn(
                          'flex-shrink-0 font-medium',
                          'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'
                        )}
                      >
                        {field.path}
                      </span>
                      <span className='min-w-0 break-all text-[var(--text-tertiary)]'>
                        {field.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* Workflow Variables */}
        {workflowVars.length > 0 && (
          <div className='mb-[2px] last:mb-0'>
            <div
              className='group flex h-[26px] cursor-pointer items-center gap-[8px] rounded-[8px] px-[6px] text-[14px] hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]'
              onClick={() => setExpandedVariables(!expandedVariables)}
            >
              <div className='relative flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-[#8B5CF6]'>
                <span className='font-bold text-[9px] text-white'>V</span>
              </div>
              <span
                className={cn(
                  'truncate font-medium',
                  'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'
                )}
              >
                Variables
              </span>
              <ChevronDownIcon
                className={cn(
                  'h-3.5 w-3.5 flex-shrink-0 transition-transform duration-100',
                  'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]',
                  expandedVariables && 'rotate-180'
                )}
              />
            </div>
            {expandedVariables && (
              <div className='relative mt-[2px] ml-[12px] space-y-[2px] pl-[10px]'>
                <div className='pointer-events-none absolute top-[4px] bottom-[4px] left-0 w-px bg-[var(--border)]' />
                {workflowVars.map((v) => (
                  <div
                    key={v.ref}
                    className='group flex min-h-[26px] flex-wrap items-baseline gap-x-[8px] gap-y-[2px] rounded-[8px] px-[6px] py-[4px] text-[14px] hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]'
                    onContextMenu={(e) => handleValueContextMenu(e, v.value)}
                  >
                    <span className='flex-shrink-0 font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'>
                      {v.name}
                    </span>
                    <span className='min-w-0 break-all text-[var(--text-tertiary)]'>{v.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Environment Variables */}
        {envVars.length > 0 && (
          <div className='mb-[2px] last:mb-0'>
            <div
              className='group flex h-[26px] cursor-pointer items-center gap-[8px] rounded-[8px] px-[6px] text-[14px] hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]'
              onClick={() => setExpandedEnvVars(!expandedEnvVars)}
            >
              <div className='relative flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-[#6B7280]'>
                <span className='font-bold text-[9px] text-white'>E</span>
              </div>
              <span
                className={cn(
                  'truncate font-medium',
                  'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'
                )}
              >
                Environment Variables
              </span>
              <ChevronDownIcon
                className={cn(
                  'h-3.5 w-3.5 flex-shrink-0 transition-transform duration-100',
                  'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]',
                  expandedEnvVars && 'rotate-180'
                )}
              />
            </div>
            {expandedEnvVars && (
              <div className='relative mt-[2px] ml-[12px] space-y-[2px] pl-[10px]'>
                <div className='pointer-events-none absolute top-[4px] bottom-[4px] left-0 w-px bg-[var(--border)]' />
                {envVars.map((v) => (
                  <div
                    key={v.ref}
                    className='group flex min-h-[26px] flex-wrap items-baseline gap-x-[8px] gap-y-[2px] rounded-[8px] px-[6px] py-[4px] text-[14px] hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]'
                  >
                    <span className='flex-shrink-0 font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'>
                      {v.name}
                    </span>
                    <span className='min-w-0 break-all text-[var(--text-tertiary)]'>{v.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Icon component for rendering block icons
 */
function IconComponent({
  icon: Icon,
  className,
}: {
  icon: BlockIcon | undefined
  className?: string
}) {
  if (!Icon) return null
  return <Icon className={className} />
}

/**
 * Configuration for subflow types (loop and parallel) - matches use-subflow-editor.ts
 */
const SUBFLOW_CONFIG = {
  loop: {
    typeLabels: {
      for: 'For Loop',
      forEach: 'For Each',
      while: 'While Loop',
      doWhile: 'Do While Loop',
    },
    maxIterations: 1000,
  },
  parallel: {
    typeLabels: {
      count: 'Parallel Count',
      collection: 'Parallel Each',
    },
    maxIterations: 20,
  },
} as const

interface SubflowConfigDisplayProps {
  block: BlockState
  loop?: Loop
  parallel?: Parallel
}

/**
 * Display subflow (loop/parallel) configuration in preview mode.
 * Matches the exact UI structure of SubflowEditor.
 */
function SubflowConfigDisplay({ block, loop, parallel }: SubflowConfigDisplayProps) {
  const isLoop = block.type === 'loop'
  const config = isLoop ? SUBFLOW_CONFIG.loop : SUBFLOW_CONFIG.parallel

  // Determine current type
  const currentType = isLoop
    ? loop?.loopType || (block.data?.loopType as string) || 'for'
    : parallel?.parallelType || (block.data?.parallelType as string) || 'count'

  // Build type options for combobox - matches SubflowEditor
  const typeOptions = Object.entries(config.typeLabels).map(([value, label]) => ({
    value,
    label,
  }))

  // Determine mode
  const isCountMode = currentType === 'for' || currentType === 'count'
  const isConditionMode = currentType === 'while' || currentType === 'doWhile'

  // Get iterations value
  const iterations = isLoop
    ? (loop?.iterations ?? (block.data?.count as number) ?? 5)
    : (parallel?.count ?? (block.data?.count as number) ?? 1)

  // Get collection/condition value
  const getEditorValue = (): string => {
    if (isConditionMode && isLoop) {
      if (currentType === 'while') {
        return loop?.whileCondition || (block.data?.whileCondition as string) || ''
      }
      return loop?.doWhileCondition || (block.data?.doWhileCondition as string) || ''
    }

    if (isLoop) {
      const items = loop?.forEachItems ?? block.data?.collection
      return typeof items === 'string' ? items : JSON.stringify(items) || ''
    }

    const distribution = parallel?.distribution ?? block.data?.collection
    return typeof distribution === 'string' ? distribution : JSON.stringify(distribution) || ''
  }

  const editorValue = getEditorValue()

  // Get label for configuration field - matches SubflowEditor exactly
  const getConfigLabel = (): string => {
    if (isCountMode) {
      return `${isLoop ? 'Loop' : 'Parallel'} Iterations`
    }
    if (isConditionMode) {
      return 'While Condition'
    }
    return `${isLoop ? 'Collection' : 'Parallel'} Items`
  }

  return (
    <div className='flex-1 overflow-y-auto overflow-x-hidden pt-[5px] pb-[8px]'>
      {/* Type Selection - matches SubflowEditor */}
      <div>
        <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
          {isLoop ? 'Loop Type' : 'Parallel Type'}
        </Label>
        <Combobox
          options={typeOptions}
          value={currentType}
          onChange={() => {}}
          disabled
          placeholder='Select type...'
        />
      </div>

      {/* Dashed Line Separator - matches SubflowEditor */}
      <div className='px-[2px] pt-[16px] pb-[10px]'>
        <div
          className='h-[1.25px]'
          style={{
            backgroundImage:
              'repeating-linear-gradient(to right, var(--border) 0px, var(--border) 6px, transparent 6px, transparent 12px)',
          }}
        />
      </div>

      {/* Configuration - matches SubflowEditor */}
      <div>
        <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
          {getConfigLabel()}
        </Label>

        {isCountMode ? (
          <div>
            <Input
              type='text'
              value={iterations.toString()}
              onChange={() => {}}
              disabled
              className='mb-[4px]'
            />
            <div className='text-[10px] text-muted-foreground'>
              Enter a number between 1 and {config.maxIterations}
            </div>
          </div>
        ) : (
          <div className='relative'>
            <Code.Container>
              <Code.Content>
                <Code.Placeholder gutterWidth={0} show={editorValue.length === 0}>
                  {isConditionMode ? '<counter.value> < 10' : "['item1', 'item2', 'item3']"}
                </Code.Placeholder>
                <div
                  className='min-h-[24px] whitespace-pre-wrap break-all px-[12px] py-[8px] font-mono text-[13px] text-[var(--text-secondary)]'
                  style={{ pointerEvents: 'none' }}
                >
                  {editorValue || (
                    <span className='text-[var(--text-tertiary)]'>
                      {isConditionMode ? '<counter.value> < 10' : "['item1', 'item2', 'item3']"}
                    </span>
                  )}
                </div>
              </Code.Content>
            </Code.Container>
          </div>
        )}
      </div>
    </div>
  )
}

interface ExecutionData {
  input?: unknown
  output?: unknown
  status?: string
  durationMs?: number
}

interface WorkflowVariable {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'plain'
  value: unknown
}

interface BlockDetailsSidebarProps {
  block: BlockState
  executionData?: ExecutionData
  /** All block execution data for resolving variable references */
  allBlockExecutions?: Record<string, ExecutionData>
  /** All workflow blocks for mapping block names to IDs */
  workflowBlocks?: Record<string, BlockState>
  /** Workflow variables for resolving variable references */
  workflowVariables?: Record<string, WorkflowVariable>
  /** Loop configurations for subflow blocks */
  loops?: Record<string, Loop>
  /** Parallel configurations for subflow blocks */
  parallels?: Record<string, Parallel>
  /** When true, shows "Not Executed" badge if no executionData is provided */
  isExecutionMode?: boolean
  /** Optional close handler - if not provided, no close button is shown */
  onClose?: () => void
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** Minimum height for the connections section (header only) */
const MIN_CONNECTIONS_HEIGHT = 30
/** Maximum height for the connections section */
const MAX_CONNECTIONS_HEIGHT = 300
/** Default height for the connections section */
const DEFAULT_CONNECTIONS_HEIGHT = 150

/**
 * Readonly sidebar panel showing block configuration using SubBlock components.
 */
function BlockDetailsSidebarContent({
  block,
  executionData,
  allBlockExecutions,
  workflowBlocks,
  workflowVariables,
  loops,
  parallels,
  isExecutionMode = false,
  onClose,
}: BlockDetailsSidebarProps) {
  // Convert Record<string, Variable> to Array<Variable> for iteration
  const normalizedWorkflowVariables = useMemo(() => {
    if (!workflowVariables) return []
    return Object.values(workflowVariables)
  }, [workflowVariables])

  const blockConfig = getBlock(block.type) as BlockConfig | undefined
  const subBlockValues = block.subBlocks || {}

  const contentRef = useRef<HTMLDivElement>(null)
  const subBlocksRef = useRef<HTMLDivElement>(null)

  // Connections resize state
  const [connectionsHeight, setConnectionsHeight] = useState(DEFAULT_CONNECTIONS_HEIGHT)
  const [isResizing, setIsResizing] = useState(false)
  const startYRef = useRef<number>(0)
  const startHeightRef = useRef<number>(0)

  const {
    wrapText,
    toggleWrapText,
    isSearchActive,
    searchQuery,
    setSearchQuery,
    matchCount,
    currentMatchIndex,
    activateSearch,
    closeSearch,
    goToNextMatch,
    goToPreviousMatch,
    handleMatchCountChange,
    searchInputRef,
  } = useCodeViewerFeatures({ contentRef })

  const {
    isOpen: isContextMenuOpen,
    position: contextMenuPosition,
    menuRef: contextMenuRef,
    handleContextMenu,
    closeMenu: closeContextMenu,
  } = useContextMenu()

  const [contextMenuData, setContextMenuData] = useState({ content: '', copyOnly: false })

  const openContextMenu = useCallback(
    (e: React.MouseEvent, content: string, copyOnly: boolean) => {
      setContextMenuData({ content, copyOnly })
      handleContextMenu(e)
    },
    [handleContextMenu]
  )

  const handleExecutionContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const parts: string[] = []
      if (executionData?.input) {
        parts.push(`// Input\n${formatValueAsJson(executionData.input)}`)
      }
      if (executionData?.output) {
        parts.push(`// Output\n${formatValueAsJson(executionData.output)}`)
      }
      if (parts.length > 0) {
        openContextMenu(e, parts.join('\n\n'), false)
      }
    },
    [executionData, openContextMenu]
  )

  const handleSubblockContextMenu = useCallback(
    (e: React.MouseEvent, config: SubBlockConfig) => {
      if (config.password || config.type === 'oauth-input') return

      const valueObj = subBlockValues[config.id]
      const value =
        valueObj && typeof valueObj === 'object' && 'value' in valueObj
          ? (valueObj as { value: unknown }).value
          : valueObj

      if (value !== undefined && value !== null && value !== '') {
        const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        openContextMenu(e, content, true)
      }
    },
    [subBlockValues, openContextMenu]
  )

  const handleCopy = useCallback(() => {
    if (contextMenuData.content) {
      navigator.clipboard.writeText(contextMenuData.content)
    }
  }, [contextMenuData.content])

  /**
   * Handles mouse down event on the resize handle to initiate resizing
   */
  const handleConnectionsResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsResizing(true)
      startYRef.current = e.clientY
      startHeightRef.current = connectionsHeight
    },
    [connectionsHeight]
  )

  /**
   * Toggle connections collapsed state
   */
  const toggleConnectionsCollapsed = useCallback(() => {
    setConnectionsHeight((prev) =>
      prev <= MIN_CONNECTIONS_HEIGHT ? DEFAULT_CONNECTIONS_HEIGHT : MIN_CONNECTIONS_HEIGHT
    )
  }, [])

  /**
   * Sets up resize event listeners during resize operations
   */
  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = startYRef.current - e.clientY // Inverted because we're resizing from bottom up
      let newHeight = startHeightRef.current + deltaY

      // Clamp height between fixed min and max for stable behavior
      newHeight = Math.max(MIN_CONNECTIONS_HEIGHT, Math.min(MAX_CONNECTIONS_HEIGHT, newHeight))
      setConnectionsHeight(newHeight)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])

  // Determine if connections are at minimum height (collapsed state)
  const isConnectionsAtMinHeight = connectionsHeight <= MIN_CONNECTIONS_HEIGHT + 5

  const blockNameToId = useMemo(() => {
    const map = new Map<string, string>()
    if (workflowBlocks) {
      for (const [blockId, blockData] of Object.entries(workflowBlocks)) {
        if (blockData.name) {
          map.set(normalizeName(blockData.name), blockId)
        }
      }
    }
    return map
  }, [workflowBlocks])

  const resolveReference = useMemo(() => {
    return (reference: string): unknown => {
      if (!allBlockExecutions || !workflowBlocks) return undefined
      if (!reference.startsWith('<') || !reference.endsWith('>')) return undefined

      const inner = reference.slice(1, -1) // Remove < and >
      const parts = inner.split('.')
      if (parts.length < 1) return undefined

      const [blockName, ...pathParts] = parts
      const normalizedBlockName = normalizeName(blockName)

      const blockId = blockNameToId.get(normalizedBlockName)
      if (!blockId) return undefined

      const blockExecution = allBlockExecutions[blockId]
      if (!blockExecution?.output) return undefined

      if (pathParts.length === 0) {
        return blockExecution.output
      }

      return navigatePath(blockExecution.output, pathParts)
    }
  }, [allBlockExecutions, workflowBlocks, blockNameToId])

  const extractedRefs = useMemo(
    () => extractAllReferencesFromSubBlocks(subBlockValues),
    [subBlockValues]
  )

  const resolvedConnections = useMemo((): ResolvedConnection[] => {
    if (!allBlockExecutions || !workflowBlocks) return []

    const seen = new Set<string>()
    const blockMap = new Map<string, ResolvedConnection>()

    for (const ref of extractedRefs.blockRefs) {
      if (seen.has(ref)) continue

      const inner = ref.slice(1, -1)
      const parts = inner.split('.')
      if (parts.length < 1) continue

      const [blockName, ...pathParts] = parts
      const normalizedBlockName = normalizeName(blockName)
      const blockId = blockNameToId.get(normalizedBlockName)
      if (!blockId) continue

      const sourceBlock = workflowBlocks[blockId]
      if (!sourceBlock) continue

      const resolvedValue = resolveReference(ref)
      if (resolvedValue === undefined) continue

      seen.add(ref)

      if (!blockMap.has(blockId)) {
        blockMap.set(blockId, {
          blockId,
          blockName: sourceBlock.name || blockName,
          blockType: sourceBlock.type,
          fields: [],
        })
      }

      const connection = blockMap.get(blockId)!
      connection.fields.push({
        path: pathParts.join('.') || 'output',
        value: formatInlineValue(resolvedValue),
        tag: ref,
      })
    }

    return Array.from(blockMap.values())
  }, [extractedRefs.blockRefs, allBlockExecutions, workflowBlocks, blockNameToId, resolveReference])

  const resolvedWorkflowVars = useMemo((): ResolvedVariable[] => {
    return extractedRefs.workflowVars.map((ref) => {
      const inner = ref.slice(1, -1)
      const parts = inner.split('.')
      const varName = parts.slice(1).join('.')

      let value = '—'
      if (normalizedWorkflowVariables.length > 0) {
        const normalizedVarName = normalizeName(varName)
        const matchedVar = normalizedWorkflowVariables.find(
          (v) => normalizeName(v.name) === normalizedVarName
        )
        if (matchedVar !== undefined) {
          value = formatInlineValue(matchedVar.value)
        }
      }

      return { ref, name: varName, value }
    })
  }, [extractedRefs.workflowVars, normalizedWorkflowVariables])

  const resolvedEnvVars = useMemo((): ResolvedVariable[] => {
    return extractedRefs.envVars.map((ref) => {
      const varName = ref.slice(2, -2)
      return { ref, name: varName, value: '[REDACTED]' }
    })
  }, [extractedRefs.envVars])

  // Check if this is a subflow block (loop or parallel)
  const isSubflow = block.type === 'loop' || block.type === 'parallel'
  const loopConfig = block.type === 'loop' ? loops?.[block.id] : undefined
  const parallelConfig = block.type === 'parallel' ? parallels?.[block.id] : undefined

  // Handle subflow blocks
  if (isSubflow) {
    const isLoop = block.type === 'loop'
    const SubflowIcon = isLoop ? RepeatIcon : SplitIcon
    const subflowBgColor = isLoop ? '#2FB3FF' : '#FEE12B'
    const subflowName = block.name || (isLoop ? 'Loop' : 'Parallel')

    return (
      <div className='relative flex h-full w-80 flex-col overflow-hidden border-[var(--border)] border-l bg-[var(--surface-1)]'>
        {/* Header - styled like subflow header */}
        <div className='mx-[-1px] flex flex-shrink-0 items-center gap-[8px] rounded-b-[4px] border-[var(--border)] border-x border-b bg-[var(--surface-4)] px-[12px] py-[6px]'>
          <div
            className='flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px]'
            style={{ backgroundColor: subflowBgColor }}
          >
            <SubflowIcon className='h-[12px] w-[12px] text-white' />
          </div>
          <span className='min-w-0 flex-1 truncate font-medium text-[14px] text-[var(--text-primary)]'>
            {subflowName}
          </span>
          {onClose && (
            <Button variant='ghost' className='!p-[4px] flex-shrink-0' onClick={onClose}>
              <X className='h-[14px] w-[14px]' />
            </Button>
          )}
        </div>

        {/* Subflow Configuration */}
        <div className='flex flex-1 flex-col overflow-hidden pt-[0px]'>
          <div className='flex-1 overflow-y-auto overflow-x-hidden'>
            <div className='readonly-preview px-[8px]'>
              {/* CSS override to show full opacity and prevent interaction instead of dimmed disabled state */}
              <style>{`
                .readonly-preview,
                .readonly-preview * {
                  cursor: default !important;
                }
                .readonly-preview [disabled],
                .readonly-preview [data-disabled],
                .readonly-preview input,
                .readonly-preview textarea,
                .readonly-preview [role="combobox"],
                .readonly-preview [role="slider"],
                .readonly-preview [role="switch"],
                .readonly-preview [role="checkbox"] {
                  opacity: 1 !important;
                  pointer-events: none;
                }
                .readonly-preview .opacity-50 {
                  opacity: 1 !important;
                }
              `}</style>
              <SubflowConfigDisplay block={block} loop={loopConfig} parallel={parallelConfig} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!blockConfig) {
    return (
      <div className='flex h-full w-80 flex-col overflow-hidden border-[var(--border)] border-l bg-[var(--surface-1)]'>
        <div className='mx-[-1px] flex items-center gap-[8px] rounded-b-[4px] border-[var(--border)] border-x border-b bg-[var(--surface-4)] px-[12px] py-[6px]'>
          <div className='flex h-[18px] w-[18px] items-center justify-center rounded-[4px] bg-[var(--surface-3)]' />
          <span className='font-medium text-[14px] text-[var(--text-primary)]'>
            {block.name || 'Unknown Block'}
          </span>
        </div>
        <div className='p-[12px]'>
          <p className='text-[13px] text-[var(--text-secondary)]'>Block configuration not found.</p>
        </div>
      </div>
    )
  }

  const visibleSubBlocks = blockConfig.subBlocks.filter((subBlock) => {
    if (subBlock.hidden || subBlock.hideFromPreview) return false
    if (subBlock.mode === 'trigger') return false
    if (subBlock.condition) {
      return evaluateCondition(subBlock.condition, subBlockValues)
    }
    return true
  })

  const statusVariant =
    executionData?.status === 'error'
      ? 'red'
      : executionData?.status === 'success'
        ? 'green'
        : 'gray'

  return (
    <div className='relative flex h-full w-80 flex-col overflow-hidden border-[var(--border)] border-l bg-[var(--surface-1)]'>
      {/* Header - styled like editor */}
      <div className='mx-[-1px] flex flex-shrink-0 items-center gap-[8px] rounded-b-[4px] border-[var(--border)] border-x border-b bg-[var(--surface-4)] px-[12px] py-[6px]'>
        <div
          className='flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px]'
          style={{ backgroundColor: blockConfig.bgColor }}
        >
          <IconComponent
            icon={blockConfig.icon}
            className='h-[12px] w-[12px] text-[var(--white)]'
          />
        </div>
        <span className='min-w-0 flex-1 truncate font-medium text-[14px] text-[var(--text-primary)]'>
          {block.name || blockConfig.name}
        </span>
        {block.enabled === false && (
          <Badge variant='red' size='sm'>
            Disabled
          </Badge>
        )}
        {onClose && (
          <Button variant='ghost' className='!p-[4px] flex-shrink-0' onClick={onClose}>
            <X className='h-[14px] w-[14px]' />
          </Button>
        )}
      </div>

      {/* Content area */}
      <div className='flex flex-1 flex-col overflow-hidden pt-[0px]'>
        {/* Subblocks Section */}
        <div ref={subBlocksRef} className='subblocks-section flex flex-1 flex-col overflow-hidden'>
          <div className='flex-1 overflow-y-auto overflow-x-hidden'>
            {/* Not Executed Banner - shown when in execution mode but block wasn't executed */}
            {isExecutionMode && !executionData && (
              <div className='flex min-w-0 flex-col gap-[8px] overflow-hidden border-[var(--border)] border-b px-[12px] py-[10px]'>
                <div className='flex items-center justify-between'>
                  <Badge variant='gray-secondary' size='sm' dot>
                    Not Executed
                  </Badge>
                </div>
              </div>
            )}

            {/* Execution Input/Output (if provided) */}
            {executionData &&
            (executionData.input !== undefined || executionData.output !== undefined) ? (
              <div className='flex min-w-0 flex-col gap-[8px] overflow-hidden border-[var(--border)] border-b px-[12px] py-[10px]'>
                {/* Execution Status & Duration Header */}
                {(executionData.status || executionData.durationMs !== undefined) && (
                  <div className='flex items-center justify-between'>
                    {executionData.status && (
                      <Badge variant={statusVariant} size='sm' dot>
                        <span className='capitalize'>{executionData.status}</span>
                      </Badge>
                    )}
                    {executionData.durationMs !== undefined && (
                      <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
                        {formatDuration(executionData.durationMs)}
                      </span>
                    )}
                  </div>
                )}

                {/* Divider between Status/Duration and Input/Output */}
                {(executionData.status || executionData.durationMs !== undefined) &&
                  (executionData.input !== undefined || executionData.output !== undefined) && (
                    <div className='border-[var(--border)] border-t border-dashed' />
                  )}

                {/* Input Section */}
                {executionData.input !== undefined && (
                  <ExecutionDataSection
                    title='Input'
                    data={executionData.input}
                    wrapText={wrapText}
                    searchQuery={isSearchActive ? searchQuery : undefined}
                    currentMatchIndex={currentMatchIndex}
                    onMatchCountChange={handleMatchCountChange}
                    contentRef={contentRef}
                    onContextMenu={handleExecutionContextMenu}
                  />
                )}

                {/* Divider between Input and Output */}
                {executionData.input !== undefined && executionData.output !== undefined && (
                  <div className='border-[var(--border)] border-t border-dashed' />
                )}

                {/* Output Section */}
                {executionData.output !== undefined && (
                  <ExecutionDataSection
                    title={executionData.status === 'error' ? 'Error' : 'Output'}
                    data={executionData.output}
                    isError={executionData.status === 'error'}
                    wrapText={wrapText}
                    searchQuery={isSearchActive ? searchQuery : undefined}
                    currentMatchIndex={currentMatchIndex}
                    onMatchCountChange={handleMatchCountChange}
                    contentRef={contentRef}
                    onContextMenu={handleExecutionContextMenu}
                  />
                )}
              </div>
            ) : null}

            {/* Subblock Values - Using SubBlock components in preview mode */}
            <div className='readonly-preview px-[8px] py-[8px]'>
              {/* CSS override to show full opacity and prevent interaction instead of dimmed disabled state */}
              <style>{`
            .readonly-preview,
            .readonly-preview * {
              cursor: default !important;
            }
            .readonly-preview [disabled],
            .readonly-preview [data-disabled],
            .readonly-preview input,
            .readonly-preview textarea,
            .readonly-preview [role="combobox"],
            .readonly-preview [role="slider"],
            .readonly-preview [role="switch"],
            .readonly-preview [role="checkbox"] {
              opacity: 1 !important;
              pointer-events: none;
            }
            .readonly-preview .opacity-50 {
              opacity: 1 !important;
            }
          `}</style>
              {visibleSubBlocks.length > 0 ? (
                <div className='flex flex-col'>
                  {visibleSubBlocks.map((subBlockConfig, index) => (
                    <div
                      key={subBlockConfig.id}
                      className='subblock-row'
                      onContextMenu={(e) => handleSubblockContextMenu(e, subBlockConfig)}
                    >
                      <SubBlock
                        blockId={block.id}
                        config={subBlockConfig}
                        isPreview={true}
                        subBlockValues={subBlockValues}
                        disabled={true}
                      />
                      {index < visibleSubBlocks.length - 1 && (
                        <div className='subblock-divider px-[2px] pt-[16px] pb-[13px]'>
                          <div
                            className='h-[1.25px]'
                            style={{
                              backgroundImage:
                                'repeating-linear-gradient(to right, var(--border) 0px, var(--border) 6px, transparent 6px, transparent 12px)',
                            }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className='py-[16px] text-center'>
                  <p className='text-[13px] text-[var(--text-secondary)]'>
                    No configurable fields for this block.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Connections Section - Only show when there are connections */}
        {(resolvedConnections.length > 0 ||
          resolvedWorkflowVars.length > 0 ||
          resolvedEnvVars.length > 0) && (
          <ConnectionsSection
            connections={resolvedConnections}
            workflowVars={resolvedWorkflowVars}
            envVars={resolvedEnvVars}
            onContextMenu={(e, value) => openContextMenu(e, value, true)}
            height={connectionsHeight}
            isResizing={isResizing}
            isAtMinHeight={isConnectionsAtMinHeight}
            onResizeMouseDown={handleConnectionsResizeMouseDown}
            onToggleCollapsed={toggleConnectionsCollapsed}
          />
        )}
      </div>

      {/* Search Overlay */}
      {isSearchActive && (
        <div
          className='absolute top-[40px] right-[8px] z-30 flex h-[34px] items-center gap-[6px] rounded-[4px] border border-[var(--border)] bg-[var(--surface-1)] px-[6px] shadow-sm'
          onClick={(e) => e.stopPropagation()}
        >
          <Input
            ref={searchInputRef}
            type='text'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder='Search...'
            className='mr-[2px] h-[23px] w-[94px] text-[12px]'
          />
          <span
            className={cn(
              'min-w-[45px] text-center text-[11px]',
              matchCount > 0 ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]'
            )}
          >
            {matchCount > 0 ? `${currentMatchIndex + 1}/${matchCount}` : '0/0'}
          </span>
          <Button
            variant='ghost'
            className='!p-1'
            onClick={goToPreviousMatch}
            disabled={matchCount === 0}
            aria-label='Previous match'
          >
            <ArrowUp className='h-[12px] w-[12px]' />
          </Button>
          <Button
            variant='ghost'
            className='!p-1'
            onClick={goToNextMatch}
            disabled={matchCount === 0}
            aria-label='Next match'
          >
            <ArrowDown className='h-[12px] w-[12px]' />
          </Button>
          <Button variant='ghost' className='!p-1' onClick={closeSearch} aria-label='Close search'>
            <X className='h-[12px] w-[12px]' />
          </Button>
        </div>
      )}

      {/* Context Menu */}
      <SnapshotContextMenu
        isOpen={isContextMenuOpen}
        position={contextMenuPosition}
        menuRef={contextMenuRef}
        onClose={closeContextMenu}
        onCopy={handleCopy}
        onSearch={activateSearch}
        wrapText={wrapText}
        onToggleWrap={toggleWrapText}
        copyOnly={contextMenuData.copyOnly}
      />
    </div>
  )
}

/**
 * Block details sidebar wrapped in ReactFlowProvider for hook compatibility.
 */
export function BlockDetailsSidebar(props: BlockDetailsSidebarProps) {
  return (
    <ReactFlowProvider>
      <BlockDetailsSidebarContent {...props} />
    </ReactFlowProvider>
  )
}
