'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown as ChevronDownIcon, X } from 'lucide-react'
import { ReactFlowProvider } from 'reactflow'
import { Badge, Button, ChevronDown, Code } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { extractReferencePrefixes } from '@/lib/workflows/sanitization/references'
import { SubBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components'
import { getBlock } from '@/blocks'
import type { BlockConfig, BlockIcon, SubBlockConfig } from '@/blocks/types'
import { normalizeName } from '@/executor/constants'
import { navigatePath } from '@/executor/variables/resolvers/reference'
import type { BlockState } from '@/stores/workflows/workflow/types'

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

/**
 * Extract all variable references from nested subblock values
 */
function extractAllReferencesFromSubBlocks(subBlockValues: Record<string, unknown>): string[] {
  const refs = new Set<string>()

  const processValue = (value: unknown) => {
    if (typeof value === 'string') {
      const extracted = extractReferencePrefixes(value)
      extracted.forEach((ref) => refs.add(ref.raw))
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
  return Array.from(refs)
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
}

/**
 * Collapsible section for execution data (input/output)
 * Uses Code.Viewer for proper syntax highlighting matching the logs UI
 */
function ExecutionDataSection({ title, data, isError = false }: ExecutionDataSectionProps) {
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
            <Code.Viewer
              code={jsonString}
              language='json'
              className='!bg-[var(--surface-3)] min-h-0 max-w-full rounded-[6px] border-0 [word-break:break-all]'
              wrapText
            />
          )}
        </>
      )}
    </div>
  )
}

/**
 * Section showing resolved variable references - styled like the connections section in editor
 */
function ResolvedConnectionsSection({ connections }: { connections: ResolvedConnection[] }) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set())

  useEffect(() => {
    setExpandedBlocks(new Set(connections.map((c) => c.blockId)))
  }, [connections])

  if (connections.length === 0) return null

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

  return (
    <div className='flex flex-shrink-0 flex-col border-[var(--border)] border-t'>
      {/* Header with Chevron */}
      <div
        className='flex flex-shrink-0 cursor-pointer items-center gap-[8px] px-[10px] pt-[5px] pb-[5px]'
        onClick={() => setIsCollapsed(!isCollapsed)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setIsCollapsed(!isCollapsed)
          }
        }}
        role='button'
        tabIndex={0}
        aria-label={isCollapsed ? 'Expand connections' : 'Collapse connections'}
      >
        <ChevronDownIcon
          className={cn('h-[14px] w-[14px] transition-transform', !isCollapsed && 'rotate-180')}
        />
        <div className='font-medium text-[13px] text-[var(--text-primary)]'>Connections</div>
      </div>

      {/* Content - styled like ConnectionBlocks */}
      {!isCollapsed && (
        <div className='space-y-[2px] px-[6px] pb-[8px]'>
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
                        className='group flex h-[26px] items-center gap-[8px] rounded-[8px] px-[6px] text-[14px] hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]'
                      >
                        <span
                          className={cn(
                            'flex-shrink-0 font-medium',
                            'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'
                          )}
                        >
                          {field.path}
                        </span>
                        <span className='min-w-0 flex-1 truncate text-[var(--text-tertiary)]'>
                          {field.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
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

interface ExecutionData {
  input?: unknown
  output?: unknown
  status?: string
  durationMs?: number
}

interface BlockDetailsSidebarProps {
  block: BlockState
  executionData?: ExecutionData
  /** All block execution data for resolving variable references */
  allBlockExecutions?: Record<string, ExecutionData>
  /** All workflow blocks for mapping block names to IDs */
  workflowBlocks?: Record<string, BlockState>
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

/**
 * Readonly sidebar panel showing block configuration using SubBlock components.
 */
function BlockDetailsSidebarContent({
  block,
  executionData,
  allBlockExecutions,
  workflowBlocks,
  isExecutionMode = false,
  onClose,
}: BlockDetailsSidebarProps) {
  const blockConfig = getBlock(block.type) as BlockConfig | undefined
  const subBlockValues = block.subBlocks || {}

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

  // Group resolved variables by source block for display
  const resolvedConnections = useMemo((): ResolvedConnection[] => {
    if (!allBlockExecutions || !workflowBlocks) return []

    const allRefs = extractAllReferencesFromSubBlocks(subBlockValues)
    const seen = new Set<string>()
    const blockMap = new Map<string, ResolvedConnection>()

    for (const ref of allRefs) {
      if (seen.has(ref)) continue

      // Parse reference: <blockName.path.to.value>
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

      // Get or create block entry
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
  }, [subBlockValues, allBlockExecutions, workflowBlocks, blockNameToId, resolveReference])

  if (!blockConfig) {
    return (
      <div className='flex h-full w-80 flex-col overflow-hidden rounded-r-[8px] border-[var(--border)] border-l bg-[var(--surface-1)]'>
        <div className='flex items-center gap-[8px] bg-[var(--surface-4)] px-[12px] py-[8px]'>
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
    <div className='flex h-full w-80 flex-col overflow-hidden rounded-r-[8px] border-[var(--border)] border-l bg-[var(--surface-1)]'>
      {/* Header - styled like editor */}
      <div className='flex flex-shrink-0 items-center gap-[8px] bg-[var(--surface-4)] px-[12px] py-[8px]'>
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

      {/* Scrollable content */}
      <div className='flex-1 overflow-y-auto'>
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
              <ExecutionDataSection title='Input' data={executionData.input} />
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
                <div key={subBlockConfig.id} className='subblock-row'>
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

      {/* Resolved Variables Section - Pinned at bottom, outside scrollable area */}
      {resolvedConnections.length > 0 && (
        <ResolvedConnectionsSection connections={resolvedConnections} />
      )}
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
