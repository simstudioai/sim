import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Handle, type NodeProps, Position } from 'reactflow'
import { Badge } from '@/components/emcn/components/badge/badge'
import { Tooltip } from '@/components/emcn/components/tooltip/tooltip'
import { getEnv, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useBlockCore } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import {
  BLOCK_DIMENSIONS,
  useBlockDimensions,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-block-dimensions'
import { SELECTOR_TYPES_HYDRATION_REQUIRED, type SubBlockConfig } from '@/blocks/types'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useCredentialDisplay } from '@/hooks/use-credential-display'
import { useDisplayName } from '@/hooks/use-display-name'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { ActionBar, Connections } from './components'
import { useBlockProperties, useChildWorkflow, useScheduleInfo, useWebhookInfo } from './hooks'
import type { WorkflowBlockProps } from './types'
import { getProviderName, shouldSkipBlockRender } from './utils'

const logger = createLogger('WorkflowBlock')

/**
 * Type guard for table row structure
 */
interface TableRow {
  id: string
  cells: Record<string, string>
}

/**
 * Type guard for field format structure (input format, response format)
 */
interface FieldFormat {
  id: string
  name: string
  type?: string
  value?: string
  collapsed?: boolean
}

/**
 * Checks if a value is a table row array
 */
const isTableRowArray = (value: unknown): value is TableRow[] => {
  if (!Array.isArray(value) || value.length === 0) return false
  const firstItem = value[0]
  return (
    typeof firstItem === 'object' &&
    firstItem !== null &&
    'id' in firstItem &&
    'cells' in firstItem &&
    typeof firstItem.cells === 'object'
  )
}

/**
 * Checks if a value is a field format array
 */
const isFieldFormatArray = (value: unknown): value is FieldFormat[] => {
  if (!Array.isArray(value) || value.length === 0) return false
  const firstItem = value[0]
  return (
    typeof firstItem === 'object' && firstItem !== null && 'id' in firstItem && 'name' in firstItem
  )
}

/**
 * Checks if a value is a plain object (not array, not null)
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Type guard for variable assignments array
 */
const isVariableAssignmentsArray = (
  value: unknown
): value is Array<{ id?: string; variableId?: string; variableName?: string; value: any }> => {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        ('variableName' in item || 'variableId' in item)
    )
  )
}

/**
 * Formats a subblock value for display, intelligently handling nested objects and arrays.
 */
const getDisplayValue = (value: unknown): string => {
  if (value == null || value === '') return '-'

  if (isVariableAssignmentsArray(value)) {
    const names = value.map((a) => a.variableName).filter((name): name is string => !!name)
    if (names.length === 0) return '-'
    if (names.length === 1) return names[0]
    if (names.length === 2) return `${names[0]}, ${names[1]}`
    return `${names[0]}, ${names[1]} +${names.length - 2}`
  }

  if (isTableRowArray(value)) {
    const nonEmptyRows = value.filter((row) => {
      const cellValues = Object.values(row.cells)
      return cellValues.some((cell) => cell && cell.trim() !== '')
    })

    if (nonEmptyRows.length === 0) return '-'
    if (nonEmptyRows.length === 1) {
      const firstRow = nonEmptyRows[0]
      const cellEntries = Object.entries(firstRow.cells).filter(([, val]) => val?.trim())
      if (cellEntries.length === 0) return '-'
      const preview = cellEntries
        .slice(0, 2)
        .map(([key, val]) => `${key}: ${val}`)
        .join(', ')
      return cellEntries.length > 2 ? `${preview}...` : preview
    }
    return `${nonEmptyRows.length} rows`
  }

  if (isFieldFormatArray(value)) {
    const namedFields = value.filter((field) => field.name && field.name.trim() !== '')
    if (namedFields.length === 0) return '-'
    if (namedFields.length === 1) return namedFields[0].name
    if (namedFields.length === 2) return `${namedFields[0].name}, ${namedFields[1].name}`
    return `${namedFields[0].name}, ${namedFields[1].name} +${namedFields.length - 2}`
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(
      ([, val]) => val !== null && val !== undefined && val !== ''
    )

    if (entries.length === 0) return '-'
    if (entries.length === 1) {
      const [key, val] = entries[0]
      const valStr = String(val).slice(0, 30)
      return `${key}: ${valStr}${String(val).length > 30 ? '...' : ''}`
    }
    const preview = entries
      .slice(0, 2)
      .map(([key]) => key)
      .join(', ')
    return entries.length > 2 ? `${preview} +${entries.length - 2}` : preview
  }

  if (Array.isArray(value)) {
    const nonEmptyItems = value.filter((item) => item !== null && item !== undefined && item !== '')
    if (nonEmptyItems.length === 0) return '-'

    const getItemDisplayValue = (item: unknown): string => {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>
        return String(obj.title || obj.name || obj.label || obj.id || JSON.stringify(item))
      }
      return String(item)
    }

    if (nonEmptyItems.length === 1) return getItemDisplayValue(nonEmptyItems[0])
    if (nonEmptyItems.length === 2) {
      return `${getItemDisplayValue(nonEmptyItems[0])}, ${getItemDisplayValue(nonEmptyItems[1])}`
    }
    return `${getItemDisplayValue(nonEmptyItems[0])}, ${getItemDisplayValue(nonEmptyItems[1])} +${nonEmptyItems.length - 2}`
  }

  const stringValue = String(value)
  if (stringValue === '[object Object]') {
    try {
      const json = JSON.stringify(value)
      if (json.length <= 40) return json
      return `${json.slice(0, 37)}...`
    } catch {
      return '-'
    }
  }

  return stringValue.trim().length > 0 ? stringValue : '-'
}

/**
 * Renders a single subblock row with title and optional value.
 * Automatically hydrates IDs to display names for all selector types.
 */
const SubBlockRow = ({
  title,
  value,
  subBlock,
  rawValue,
  workspaceId,
  workflowId,
  allSubBlockValues,
}: {
  title: string
  value?: string
  subBlock?: SubBlockConfig
  rawValue?: unknown
  workspaceId?: string
  workflowId?: string
  allSubBlockValues?: Record<string, { value: unknown }>
}) => {
  const getStringValue = useCallback(
    (key?: string): string | undefined => {
      if (!key || !allSubBlockValues) return undefined
      const candidate = allSubBlockValues[key]?.value
      return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined
    },
    [allSubBlockValues]
  )

  const dependencyValues = useMemo(() => {
    if (!subBlock?.dependsOn?.length) return {}
    return subBlock.dependsOn.reduce<Record<string, string>>((accumulator, dependency) => {
      const dependencyValue = getStringValue(dependency)
      if (dependencyValue) {
        accumulator[dependency] = dependencyValue
      }
      return accumulator
    }, {})
  }, [getStringValue, subBlock?.dependsOn])

  const { displayName: credentialName } = useCredentialDisplay(
    subBlock?.type === 'oauth-input' && typeof rawValue === 'string' ? rawValue : undefined,
    subBlock?.provider
  )

  const credentialId = dependencyValues.credential
  const knowledgeBaseId = dependencyValues.knowledgeBaseId

  const dropdownLabel = useMemo(() => {
    if (!subBlock || (subBlock.type !== 'dropdown' && subBlock.type !== 'combobox')) return null
    if (!rawValue || typeof rawValue !== 'string') return null

    const options = typeof subBlock.options === 'function' ? subBlock.options() : subBlock.options
    if (!options) return null

    const option = options.find((opt) =>
      typeof opt === 'string' ? opt === rawValue : opt.id === rawValue
    )

    if (!option) return null
    return typeof option === 'string' ? option : option.label
  }, [subBlock, rawValue])

  const genericDisplayName = useDisplayName(subBlock, rawValue, {
    workspaceId,
    provider: subBlock?.provider,
    credentialId: typeof credentialId === 'string' ? credentialId : undefined,
    knowledgeBaseId: typeof knowledgeBaseId === 'string' ? knowledgeBaseId : undefined,
    domain: getStringValue('domain'),
    teamId: getStringValue('teamId'),
    projectId: getStringValue('projectId'),
    planId: getStringValue('planId'),
  })

  // Subscribe to variables store to reactively update when variables change
  const allVariables = useVariablesStore((state) => state.variables)

  // Special handling for variables-input to hydrate variable IDs to names from variables store
  const variablesDisplayValue = useMemo(() => {
    if (subBlock?.type !== 'variables-input' || !isVariableAssignmentsArray(rawValue)) {
      return null
    }

    const workflowVariables = Object.values(allVariables).filter(
      (v: any) => v.workflowId === workflowId
    )

    const names = rawValue
      .map((a) => {
        // Prioritize ID lookup (source of truth) over stored name
        if (a.variableId) {
          const variable = workflowVariables.find((v: any) => v.id === a.variableId)
          return variable?.name
        }
        if (a.variableName) return a.variableName
        return null
      })
      .filter((name): name is string => !!name)

    if (names.length === 0) return null
    if (names.length === 1) return names[0]
    if (names.length === 2) return `${names[0]}, ${names[1]}`
    return `${names[0]}, ${names[1]} +${names.length - 2}`
  }, [subBlock?.type, rawValue, workflowId, allVariables])

  const isPasswordField = subBlock?.password === true
  const maskedValue = isPasswordField && value && value !== '-' ? '•••' : null

  const isSelectorType = subBlock?.type && SELECTOR_TYPES_HYDRATION_REQUIRED.includes(subBlock.type)
  const hydratedName =
    credentialName || dropdownLabel || variablesDisplayValue || genericDisplayName
  const displayValue = maskedValue || hydratedName || (isSelectorType && value ? '-' : value)

  return (
    <div className='flex items-center gap-[8px]'>
      <span className='min-w-0 truncate text-[14px] text-[var(--text-tertiary)]' title={title}>
        {title}
      </span>
      {displayValue !== undefined && (
        <span
          className='flex-1 truncate text-right text-[14px] text-[var(--white)]'
          title={displayValue}
        >
          {displayValue}
        </span>
      )}
    </div>
  )
}

export const WorkflowBlock = memo(function WorkflowBlock({
  id,
  data,
}: NodeProps<WorkflowBlockProps>) {
  const { type, config, name, isPending } = data

  const contentRef = useRef<HTMLDivElement>(null)

  const params = useParams()
  const currentWorkflowId = params.workflowId as string
  const workspaceId = params.workspaceId as string

  const {
    currentWorkflow,
    activeWorkflowId,
    isEnabled,
    isActive,
    diffStatus,
    isDeletedBlock,
    isFocused,
    handleClick,
    hasRing,
    ringStyles,
  } = useBlockCore({ blockId: id, data, isPending })

  const currentBlock = currentWorkflow.getBlockById(id)

  const { horizontalHandles, blockHeight, blockWidth, displayAdvancedMode, displayTriggerMode } =
    useBlockProperties(
      id,
      currentWorkflow.isDiffMode,
      data.isPreview ?? false,
      data.blockState,
      currentWorkflow.blocks
    )

  const { isWebhookConfigured, webhookProvider, webhookPath } = useWebhookInfo(id)

  const {
    scheduleInfo,
    isLoading: isLoadingScheduleInfo,
    reactivateSchedule,
    disableSchedule,
  } = useScheduleInfo(id, type, currentWorkflowId)

  const { childWorkflowId, childIsDeployed, childNeedsRedeploy, refetchDeployment } =
    useChildWorkflow(id, type, data.isPreview ?? false, data.subBlockValues)

  const [isDeploying, setIsDeploying] = useState(false)
  const setDeploymentStatus = useWorkflowRegistry((state) => state.setDeploymentStatus)

  const deployWorkflow = useCallback(
    async (workflowId: string) => {
      if (isDeploying) return

      try {
        setIsDeploying(true)
        const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            deployChatEnabled: false,
          }),
        })

        if (response.ok) {
          const responseData = await response.json()
          const isDeployedStatus = responseData.isDeployed ?? false
          const deployedAtTime = responseData.deployedAt
            ? new Date(responseData.deployedAt)
            : undefined
          setDeploymentStatus(
            workflowId,
            isDeployedStatus,
            deployedAtTime,
            responseData.apiKey || ''
          )
          refetchDeployment()
        } else {
          logger.error('Failed to deploy workflow')
        }
      } catch (error) {
        logger.error('Error deploying workflow:', error)
      } finally {
        setIsDeploying(false)
      }
    },
    [isDeploying, setDeploymentStatus, refetchDeployment]
  )

  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()

  /**
   * Clear credential-dependent fields when credential changes to prevent
   * stale data from persisting with new credentials.
   */
  const prevCredRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
    if (!activeWorkflowId) return
    const current = useSubBlockStore.getState().workflowValues[activeWorkflowId]?.[id]
    if (!current) return
    const cred = current.credential?.value as string | undefined
    if (prevCredRef.current !== cred) {
      prevCredRef.current = cred
      const keys = Object.keys(current)
      const dependentKeys = keys.filter((k) => k !== 'credential')
      dependentKeys.forEach((k) => collaborativeSetSubblockValue(id, k, ''))
    }
  }, [id, collaborativeSetSubblockValue])

  const currentStoreBlock = currentWorkflow.getBlockById(id)

  const isStarterBlock = type === 'starter'
  const isWebhookTriggerBlock = type === 'webhook' || type === 'generic_webhook'

  /**
   * Subscribe to this block's subblock values to track changes for conditional rendering
   * of subblocks based on their conditions.
   */
  const blockSubBlockValues = useSubBlockStore(
    useCallback(
      (state) => {
        if (!activeWorkflowId) return {}
        return state.workflowValues[activeWorkflowId]?.[id] || {}
      },
      [activeWorkflowId, id]
    )
  )

  const subBlockRowsData = useMemo(() => {
    const rows: SubBlockConfig[][] = []
    let currentRow: SubBlockConfig[] = []
    let currentRowWidth = 0

    /**
     * Get the appropriate state for conditional evaluation based on the current mode.
     * Uses preview values in preview mode, diff workflow values in diff mode,
     * or the current block's subblock values otherwise.
     */
    let stateToUse: Record<string, { value: unknown }> = {}

    if (data.isPreview && data.subBlockValues) {
      stateToUse = data.subBlockValues
    } else if (currentWorkflow.isDiffMode && currentBlock) {
      stateToUse = currentBlock.subBlocks || {}
    } else {
      stateToUse = Object.entries(blockSubBlockValues).reduce(
        (acc, [key, value]) => {
          acc[key] = { value }
          return acc
        },
        {} as Record<string, { value: unknown }>
      )
    }

    const effectiveAdvanced = displayAdvancedMode
    const effectiveTrigger = displayTriggerMode

    const visibleSubBlocks = config.subBlocks.filter((block) => {
      if (block.hidden) return false
      if (block.hideFromPreview) return false

      if (block.requiresFeature && !isTruthy(getEnv(block.requiresFeature))) {
        return false
      }

      const isPureTriggerBlock = config?.triggers?.enabled && config.category === 'triggers'

      if (effectiveTrigger) {
        const isValidTriggerSubblock = isPureTriggerBlock
          ? block.mode === 'trigger' || !block.mode
          : block.mode === 'trigger'

        if (!isValidTriggerSubblock) {
          return false
        }
      } else {
        if (block.mode === 'trigger') {
          return false
        }
      }

      if (block.mode === 'basic' && effectiveAdvanced) return false
      if (block.mode === 'advanced' && !effectiveAdvanced) return false

      if (!block.condition) return true

      const actualCondition =
        typeof block.condition === 'function' ? block.condition() : block.condition

      const fieldValue = stateToUse[actualCondition.field]?.value
      const andFieldValue = actualCondition.and
        ? stateToUse[actualCondition.and.field]?.value
        : undefined

      const isValueMatch = Array.isArray(actualCondition.value)
        ? fieldValue != null &&
          (actualCondition.not
            ? !actualCondition.value.includes(fieldValue as string | number | boolean)
            : actualCondition.value.includes(fieldValue as string | number | boolean))
        : actualCondition.not
          ? fieldValue !== actualCondition.value
          : fieldValue === actualCondition.value

      const isAndValueMatch =
        !actualCondition.and ||
        (Array.isArray(actualCondition.and.value)
          ? andFieldValue != null &&
            (actualCondition.and.not
              ? !actualCondition.and.value.includes(andFieldValue as string | number | boolean)
              : actualCondition.and.value.includes(andFieldValue as string | number | boolean))
          : actualCondition.and.not
            ? andFieldValue !== actualCondition.and.value
            : andFieldValue === actualCondition.and.value)

      return isValueMatch && isAndValueMatch
    })

    visibleSubBlocks.forEach((block) => {
      if (currentRowWidth + blockWidth > 1) {
        if (currentRow.length > 0) {
          rows.push([...currentRow])
        }
        currentRow = [block]
        currentRowWidth = blockWidth
      } else {
        currentRow.push(block)
        currentRowWidth += blockWidth
      }
    })

    if (currentRow.length > 0) {
      rows.push(currentRow)
    }

    return { rows, stateToUse }
  }, [
    config.subBlocks,
    config.category,
    config.triggers,
    id,
    displayAdvancedMode,
    displayTriggerMode,
    data.isPreview,
    data.subBlockValues,
    currentWorkflow.isDiffMode,
    currentBlock,
    blockSubBlockValues,
    activeWorkflowId,
  ])

  const subBlockRows = subBlockRowsData.rows
  const subBlockState = subBlockRowsData.stateToUse

  /**
   * Determine if block has content below the header (subblocks or error row).
   * Controls header border visibility and content container rendering.
   */
  const shouldShowDefaultHandles =
    config.category !== 'triggers' && type !== 'starter' && !displayTriggerMode
  const hasContentBelowHeader = subBlockRows.length > 0 || shouldShowDefaultHandles

  /**
   * Reusable styles and positioning for Handle components.
   */
  const getHandleClasses = (position: 'left' | 'right' | 'top' | 'bottom', isError = false) => {
    const baseClasses = '!z-[10] !cursor-crosshair !border-none !transition-[colors] !duration-150'
    const colorClasses = isError ? '!bg-red-400 dark:!bg-red-500' : '!bg-[var(--surface-12)]'

    const positionClasses = {
      left: '!left-[-7px] !h-5 !w-[7px] !rounded-l-[2px] !rounded-r-none hover:!left-[-10px] hover:!w-[10px] hover:!rounded-l-full',
      right:
        '!right-[-7px] !h-5 !w-[7px] !rounded-r-[2px] !rounded-l-none hover:!right-[-10px] hover:!w-[10px] hover:!rounded-r-full',
      top: '!top-[-7px] !h-[7px] !w-5 !rounded-t-[2px] !rounded-b-none hover:!top-[-10px] hover:!h-[10px] hover:!rounded-t-full',
      bottom:
        '!bottom-[-7px] !h-[7px] !w-5 !rounded-b-[2px] !rounded-t-none hover:!bottom-[-10px] hover:!h-[10px] hover:!rounded-b-full',
    }

    return cn(baseClasses, colorClasses, positionClasses[position])
  }

  const getHandleStyle = (position: 'horizontal' | 'vertical') => {
    if (position === 'horizontal') {
      return { top: '20px', transform: 'translateY(-50%)' }
    }
    return { left: '50%', transform: 'translateX(-50%)' }
  }

  /**
   * Compute per-condition rows (title/value/id) for condition blocks so we can render
   * one row per condition statement with its own output handle.
   */
  const conditionRows = useMemo(() => {
    if (type !== 'condition') return [] as { id: string; title: string; value: string }[]

    const conditionsValue = subBlockState.conditions?.value
    const raw = typeof conditionsValue === 'string' ? conditionsValue : undefined

    try {
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          return parsed.map((item: unknown, index: number) => {
            const conditionItem = item as { id?: string; value?: unknown }
            const title = index === 0 ? 'if' : index === parsed.length - 1 ? 'else' : 'else if'
            return {
              id: conditionItem?.id ?? `${id}-cond-${index}`,
              title,
              value: typeof conditionItem?.value === 'string' ? conditionItem.value : '',
            }
          })
        }
      }
    } catch (error) {
      logger.warn('Failed to parse condition subblock value', { error, blockId: id })
    }

    return [
      { id: `${id}-if`, title: 'if', value: '' },
      { id: `${id}-else`, title: 'else', value: '' },
    ]
  }, [type, subBlockState, id])

  /**
   * Compute and publish deterministic layout metrics for workflow blocks.
   * This avoids ResizeObserver/animation-frame jitter and prevents initial "jump".
   */
  useBlockDimensions({
    blockId: id,
    calculateDimensions: () => {
      const shouldShowDefaultHandles =
        config.category !== 'triggers' && type !== 'starter' && !displayTriggerMode
      const hasContentBelowHeader = subBlockRows.length > 0 || shouldShowDefaultHandles

      // Count rows based on block type and whether default handles section is shown
      const defaultHandlesRow = shouldShowDefaultHandles ? 1 : 0

      let rowsCount = 0
      if (type === 'condition') {
        rowsCount = conditionRows.length + defaultHandlesRow
      } else {
        const subblockRowCount = subBlockRows.reduce((acc, row) => acc + row.length, 0)
        rowsCount = subblockRowCount + defaultHandlesRow
      }

      const contentHeight = hasContentBelowHeader
        ? BLOCK_DIMENSIONS.WORKFLOW_CONTENT_PADDING +
          rowsCount * BLOCK_DIMENSIONS.WORKFLOW_ROW_HEIGHT
        : 0
      const calculatedHeight = Math.max(
        BLOCK_DIMENSIONS.HEADER_HEIGHT + contentHeight,
        BLOCK_DIMENSIONS.MIN_HEIGHT
      )

      return { width: BLOCK_DIMENSIONS.FIXED_WIDTH, height: calculatedHeight }
    },
    dependencies: [
      type,
      config.category,
      displayTriggerMode,
      subBlockRows.length,
      conditionRows.length,
      horizontalHandles,
    ],
  })

  const showWebhookIndicator = (isStarterBlock || isWebhookTriggerBlock) && isWebhookConfigured
  const shouldShowScheduleBadge =
    type === 'schedule' && !isLoadingScheduleInfo && scheduleInfo !== null
  const userPermissions = useUserPermissionsContext()
  const isWorkflowSelector = type === 'workflow' || type === 'workflow_input'

  return (
    <div className='group relative'>
      <div
        ref={contentRef}
        onClick={handleClick}
        className={cn(
          'relative z-[20] w-[250px] cursor-default select-none rounded-[8px] bg-[var(--surface-2)]'
        )}
      >
        {isPending && (
          <div className='-top-6 -translate-x-1/2 absolute left-1/2 z-10 transform rounded-t-md bg-amber-500 px-2 py-0.5 text-white text-xs'>
            Next Step
          </div>
        )}

        <ActionBar blockId={id} blockType={type} disabled={!userPermissions.canEdit} />

        {shouldShowDefaultHandles && (
          <Connections blockId={id} horizontalHandles={horizontalHandles} />
        )}

        {shouldShowDefaultHandles && (
          <Handle
            type='target'
            position={horizontalHandles ? Position.Left : Position.Top}
            id='target'
            className={getHandleClasses(horizontalHandles ? 'left' : 'top')}
            style={getHandleStyle(horizontalHandles ? 'horizontal' : 'vertical')}
            data-nodeid={id}
            data-handleid='target'
            isConnectableStart={false}
            isConnectableEnd={true}
            isValidConnection={(connection) => connection.source !== id}
          />
        )}

        <div
          className={cn(
            'workflow-drag-handle flex cursor-grab items-center justify-between p-[8px] [&:active]:cursor-grabbing',
            hasContentBelowHeader && 'border-[var(--divider)] border-b'
          )}
          onMouseDown={(e) => {
            e.stopPropagation()
          }}
        >
          <div className='flex min-w-0 flex-1 items-center gap-[10px]'>
            <div
              className='flex h-[24px] w-[24px] flex-shrink-0 items-center justify-center rounded-[6px]'
              style={{ backgroundColor: isEnabled ? config.bgColor : 'gray' }}
            >
              <config.icon className='h-[16px] w-[16px] text-white' />
            </div>
            <span
              className={cn('truncate font-medium text-[16px]', !isEnabled && 'text-[#808080]')}
              title={name}
            >
              {name}
            </span>
          </div>
          <div className='flex flex-shrink-0 items-center gap-2'>
            {isWorkflowSelector && childWorkflowId && (
              <>
                {typeof childIsDeployed === 'boolean' ? (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Badge
                        variant='outline'
                        className={!childIsDeployed || childNeedsRedeploy ? 'cursor-pointer' : ''}
                        style={{
                          borderColor: !childIsDeployed
                            ? '#EF4444'
                            : childNeedsRedeploy
                              ? '#FF6600'
                              : '#22C55E',
                          color: !childIsDeployed
                            ? '#EF4444'
                            : childNeedsRedeploy
                              ? '#FF6600'
                              : '#22C55E',
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (
                            (!childIsDeployed || childNeedsRedeploy) &&
                            childWorkflowId &&
                            !isDeploying
                          ) {
                            deployWorkflow(childWorkflowId)
                          }
                        }}
                      >
                        {isDeploying
                          ? 'Deploying...'
                          : !childIsDeployed
                            ? 'undeployed'
                            : childNeedsRedeploy
                              ? 'redeploy'
                              : 'deployed'}
                      </Badge>
                    </Tooltip.Trigger>
                    {(!childIsDeployed || childNeedsRedeploy) && (
                      <Tooltip.Content>
                        <span className='text-sm'>
                          {!childIsDeployed ? 'Click to deploy' : 'Click to redeploy'}
                        </span>
                      </Tooltip.Content>
                    )}
                  </Tooltip.Root>
                ) : (
                  <Badge variant='outline' style={{ visibility: 'hidden' }}>
                    deployed
                  </Badge>
                )}
              </>
            )}
            {!isEnabled && <Badge>disabled</Badge>}

            {type === 'schedule' && (
              <>
                {shouldShowScheduleBadge ? (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Badge
                        variant='outline'
                        className={scheduleInfo?.isDisabled ? 'cursor-pointer' : ''}
                        style={{
                          borderColor: scheduleInfo?.isDisabled ? '#FF6600' : '#22C55E',
                          color: scheduleInfo?.isDisabled ? '#FF6600' : '#22C55E',
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (scheduleInfo?.id) {
                            if (scheduleInfo.isDisabled) {
                              reactivateSchedule(scheduleInfo.id)
                            } else {
                              disableSchedule(scheduleInfo.id)
                            }
                          }
                        }}
                      >
                        {scheduleInfo?.isDisabled ? 'disabled' : 'scheduled'}
                      </Badge>
                    </Tooltip.Trigger>
                    {scheduleInfo?.isDisabled && (
                      <Tooltip.Content>
                        <span className='text-sm'>Click to reactivate</span>
                      </Tooltip.Content>
                    )}
                  </Tooltip.Root>
                ) : (
                  <Badge variant='outline' style={{ visibility: 'hidden' }}>
                    scheduled
                  </Badge>
                )}
              </>
            )}

            {showWebhookIndicator && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Badge
                    variant='outline'
                    className='bg-[var(--brand-tertiary)] text-[var(--brand-tertiary)]'
                  >
                    <div className='relative flex items-center justify-center'>
                      <div className='197, 94, 0.2)] absolute h-3 w-3 rounded-full bg-[rgba(34,' />
                      <div className='relative h-2 w-2 rounded-full bg-[var(--brand-tertiary)]' />
                    </div>
                    Webhook
                  </Badge>
                </Tooltip.Trigger>
                <Tooltip.Content side='top' className='max-w-[300px] p-4'>
                  {webhookProvider && webhookPath ? (
                    <>
                      <p className='text-sm'>{getProviderName(webhookProvider)} Webhook</p>
                      <p className='mt-1 text-muted-foreground text-xs'>Path: {webhookPath}</p>
                    </>
                  ) : (
                    <p className='text-muted-foreground text-sm'>
                      This workflow is triggered by a webhook.
                    </p>
                  )}
                </Tooltip.Content>
              </Tooltip.Root>
            )}
          </div>
        </div>

        {hasContentBelowHeader && (
          <div className='flex flex-col gap-[8px] p-[8px]'>
            {type === 'condition'
              ? conditionRows.map((cond) => (
                  <SubBlockRow
                    key={cond.id}
                    title={cond.title}
                    value={getDisplayValue(cond.value)}
                  />
                ))
              : subBlockRows.map((row, rowIndex) =>
                  row.map((subBlock) => {
                    const rawValue = subBlockState[subBlock.id]?.value
                    return (
                      <SubBlockRow
                        key={`${subBlock.id}-${rowIndex}`}
                        title={subBlock.title ?? subBlock.id}
                        value={getDisplayValue(rawValue)}
                        subBlock={subBlock}
                        rawValue={rawValue}
                        workspaceId={workspaceId}
                        workflowId={currentWorkflowId}
                        allSubBlockValues={subBlockState}
                      />
                    )
                  })
                )}
            {shouldShowDefaultHandles && <SubBlockRow title='error' />}
          </div>
        )}

        {type === 'condition' && (
          <>
            {conditionRows.map((cond, condIndex) => {
              const topOffset = 60 + condIndex * 29
              return (
                <Handle
                  key={`handle-${cond.id}`}
                  type='source'
                  position={Position.Right}
                  id={`condition-${cond.id}`}
                  className={getHandleClasses('right')}
                  style={{ top: `${topOffset}px`, transform: 'translateY(-50%)' }}
                  data-nodeid={id}
                  data-handleid={`condition-${cond.id}`}
                  isConnectableStart={true}
                  isConnectableEnd={false}
                  isValidConnection={(connection) => connection.target !== id}
                />
              )
            })}
            <Handle
              type='source'
              position={Position.Right}
              id='error'
              className={getHandleClasses('right', true)}
              style={{ right: '-7px', top: 'auto', bottom: '17px', transform: 'translateY(50%)' }}
              data-nodeid={id}
              data-handleid='error'
              isConnectableStart={true}
              isConnectableEnd={false}
              isValidConnection={(connection) => connection.target !== id}
            />
          </>
        )}

        {type !== 'condition' && type !== 'response' && (
          <>
            <Handle
              type='source'
              position={horizontalHandles ? Position.Right : Position.Bottom}
              id='source'
              className={getHandleClasses(horizontalHandles ? 'right' : 'bottom')}
              style={getHandleStyle(horizontalHandles ? 'horizontal' : 'vertical')}
              data-nodeid={id}
              data-handleid='source'
              isConnectableStart={true}
              isConnectableEnd={false}
              isValidConnection={(connection) => connection.target !== id}
            />

            {shouldShowDefaultHandles && (
              <Handle
                type='source'
                position={Position.Right}
                id='error'
                className={getHandleClasses('right', true)}
                style={{ right: '-7px', top: 'auto', bottom: '17px', transform: 'translateY(50%)' }}
                data-nodeid={id}
                data-handleid='error'
                isConnectableStart={true}
                isConnectableEnd={false}
                isValidConnection={(connection) => connection.target !== id}
              />
            )}
          </>
        )}
        {hasRing && (
          <div
            className={cn('pointer-events-none absolute inset-0 z-40 rounded-[8px]', ringStyles)}
          />
        )}
      </div>
    </div>
  )
}, shouldSkipBlockRender)
