import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Handle, type NodeProps, Position, useUpdateNodeInternals } from 'reactflow'
import { Tooltip } from '@/components/emcn/components/tooltip/tooltip'
import { Badge } from '@/components/ui/badge'
import { getEnv, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { cn, validateName } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import type { SubBlockConfig } from '@/blocks/types'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useCurrentWorkflow } from '../../hooks'
import { ActionBar, ConnectionBlocks } from './components'
import { MAX_BLOCK_NAME_LENGTH } from './constants'
import {
  useBlockProperties,
  useBlockState,
  useChildWorkflow,
  useScheduleInfo,
  useWebhookInfo,
} from './hooks'
import type { WorkflowBlockProps } from './types'
import { debounce, getProviderName, shouldSkipBlockRender } from './utils'

const logger = createLogger('WorkflowBlock')

export const WorkflowBlock = memo(function WorkflowBlock({
  id,
  data,
}: NodeProps<WorkflowBlockProps>) {
  const { type, config, name, isPending } = data

  // Local UI state
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState('')

  // Refs
  const contentRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const updateNodeInternals = useUpdateNodeInternals()

  // Get the current workflow ID from URL params
  const params = useParams()
  const currentWorkflowId = params.workflowId as string

  // Use the clean abstraction for current workflow state
  const currentWorkflow = useCurrentWorkflow()
  const currentBlock = currentWorkflow.getBlockById(id)

  // Custom hooks for block functionality
  const { isEnabled, isActive, diffStatus, isDeletedBlock, fieldDiff } = useBlockState(
    id,
    currentWorkflow,
    data
  )

  const { horizontalHandles, blockHeight, blockWidth, displayAdvancedMode, displayTriggerMode } =
    useBlockProperties(
      id,
      currentWorkflow.isDiffMode,
      data.isPreview ?? false,
      data.blockState,
      currentWorkflow.blocks
    )

  // Webhook information
  const { isWebhookConfigured, webhookProvider, webhookPath } = useWebhookInfo(id)

  // Schedule information
  const {
    scheduleInfo,
    isLoading: isLoadingScheduleInfo,
    reactivateSchedule,
    disableSchedule,
  } = useScheduleInfo(id, type, currentWorkflowId)

  // Child workflow information
  const { childWorkflowId, childActiveVersion, childIsDeployed, isLoadingChildVersion } =
    useChildWorkflow(id, type, data.isPreview ?? false, data.subBlockValues)

  // Collaborative workflow actions
  const {
    collaborativeUpdateBlockName,
    collaborativeToggleBlockAdvancedMode,
    collaborativeToggleBlockTriggerMode,
    collaborativeSetSubblockValue,
  } = useCollaborativeWorkflow()

  // Clear credential-dependent fields when credential changes
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

  // Workflow store actions
  const updateBlockLayoutMetrics = useWorkflowStore((state) => state.updateBlockLayoutMetrics)

  // Active workflow ID for subblock access
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  // Check if this is a starter block or trigger block
  const isStarterBlock = type === 'starter'
  const isWebhookTriggerBlock = type === 'webhook' || type === 'generic_webhook'

  // Update node internals when handles change
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, horizontalHandles, updateNodeInternals])

  // Memoized debounce function from utils
  const debouncedLayoutUpdate = useMemo(
    () =>
      debounce((dimensions: { width: number; height: number }) => {
        if (dimensions.height !== blockHeight || dimensions.width !== blockWidth) {
          updateBlockLayoutMetrics(id, dimensions)
          updateNodeInternals(id)
        }
      }, 100),
    [blockHeight, blockWidth, updateBlockLayoutMetrics, updateNodeInternals, id]
  )

  // ResizeObserver for tracking block size changes
  useEffect(() => {
    if (!contentRef.current) return

    let rafId: number

    const resizeObserver = new ResizeObserver((entries) => {
      // Cancel any pending animation frame
      if (rafId) {
        cancelAnimationFrame(rafId)
      }

      // Schedule the update on the next animation frame
      rafId = requestAnimationFrame(() => {
        for (const entry of entries) {
          const rect = entry.target.getBoundingClientRect()
          const height = entry.borderBoxSize[0]?.blockSize ?? rect.height
          const width = entry.borderBoxSize[0]?.inlineSize ?? rect.width
          debouncedLayoutUpdate({ width, height })
        }
      })
    })

    resizeObserver.observe(contentRef.current)

    return () => {
      resizeObserver.disconnect()
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [debouncedLayoutUpdate])

  // Subscribe to this block's subblock values to track changes for conditional rendering
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

    // Get the appropriate state for conditional evaluation
    let stateToUse: Record<string, any> = {}

    if (data.isPreview && data.subBlockValues) {
      // In preview mode, use the preview values
      stateToUse = data.subBlockValues
    } else if (currentWorkflow.isDiffMode && currentBlock) {
      // In diff mode, use the diff workflow's subblock values
      stateToUse = currentBlock.subBlocks || {}
    } else {
      stateToUse = Object.entries(blockSubBlockValues).reduce(
        (acc, [key, value]) => {
          acc[key] = { value }
          return acc
        },
        {} as Record<string, any>
      )
    }

    const effectiveAdvanced = displayAdvancedMode
    const effectiveTrigger = displayTriggerMode
    const e2bClientEnabled = isTruthy(getEnv('NEXT_PUBLIC_E2B_ENABLED'))

    // Filter visible blocks and those that meet their conditions
    const visibleSubBlocks = config.subBlocks.filter((block) => {
      if (block.hidden) return false

      // Filter out E2B-related blocks if E2B is not enabled on the client
      if (!e2bClientEnabled && (block.id === 'remoteExecution' || block.id === 'language')) {
        return false
      }

      // Determine if this is a pure trigger block (category: 'triggers')
      const isPureTriggerBlock = config?.triggers?.enabled && config.category === 'triggers'

      // When in trigger mode, filter out non-trigger subblocks
      if (effectiveTrigger) {
        // For pure trigger blocks (category: 'triggers'), allow subblocks with mode='trigger' or no mode
        // For tool blocks with trigger capability, only allow subblocks with mode='trigger'
        const isValidTriggerSubblock = isPureTriggerBlock
          ? block.mode === 'trigger' || !block.mode
          : block.mode === 'trigger'

        if (!isValidTriggerSubblock) {
          return false
        }
        // Continue to condition check below - don't return here!
      } else {
        // When NOT in trigger mode, hide trigger-specific subblocks
        if (block.mode === 'trigger') {
          return false
        }
      }

      // Handle basic/advanced modes
      if (block.mode === 'basic' && effectiveAdvanced) return false
      if (block.mode === 'advanced' && !effectiveAdvanced) return false

      // If there's no condition, the block should be shown
      if (!block.condition) return true

      // If condition is a function, call it to get the actual condition object
      const actualCondition =
        typeof block.condition === 'function' ? block.condition() : block.condition

      // Get the values of the fields this block depends on from the appropriate state
      const fieldValue = stateToUse[actualCondition.field]?.value
      const andFieldValue = actualCondition.and
        ? stateToUse[actualCondition.and.field]?.value
        : undefined

      // Check if the condition value is an array
      const isValueMatch = Array.isArray(actualCondition.value)
        ? fieldValue != null &&
          (actualCondition.not
            ? !actualCondition.value.includes(fieldValue as string | number | boolean)
            : actualCondition.value.includes(fieldValue as string | number | boolean))
        : actualCondition.not
          ? fieldValue !== actualCondition.value
          : fieldValue === actualCondition.value

      // Check both conditions if 'and' is present
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

    // Return both rows and state for stable key generation
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

  // Extract rows and state from the memoized value
  const subBlockRows = subBlockRowsData.rows
  const subBlockState = subBlockRowsData.stateToUse

  // Name editing handlers
  const handleNameClick = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent drag handler from interfering
    setEditedName(name)
    setIsEditing(true)
  }

  // Auto-focus the input when edit mode is activated
  useEffect(() => {
    if (isEditing && nameInputRef.current) {
      nameInputRef.current.focus()
    }
  }, [isEditing])

  // Handle node name change with validation
  const handleNodeNameChange = (newName: string) => {
    const validatedName = validateName(newName)
    setEditedName(validatedName.slice(0, MAX_BLOCK_NAME_LENGTH))
  }

  const handleNameSubmit = () => {
    const trimmedName = editedName.trim().slice(0, MAX_BLOCK_NAME_LENGTH)
    if (trimmedName && trimmedName !== name) {
      collaborativeUpdateBlockName(id, trimmedName)
    }
    setIsEditing(false)
  }

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSubmit()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
    }
  }

  // Check webhook indicator
  const showWebhookIndicator = (isStarterBlock || isWebhookTriggerBlock) && isWebhookConfigured

  const shouldShowScheduleBadge =
    type === 'schedule' && !isLoadingScheduleInfo && scheduleInfo !== null
  const userPermissions = useUserPermissionsContext()

  // Check if this is a workflow selector block
  const isWorkflowSelector = type === 'workflow' || type === 'workflow_input'

  return (
    <div className='group relative'>
      <div
        ref={contentRef}
        className={cn(
          'relative z-[20] w-[250px] cursor-default select-none rounded-[8px] bg-[#232323]',
          'transition-block-bg transition-ring',
          isActive && 'animate-pulse-ring ring-2 ring-blue-500',
          isPending && 'ring-2 ring-amber-500',
          // Diff highlighting
          diffStatus === 'new' && 'bg-green-50/50 ring-2 ring-green-500 dark:bg-green-900/10',
          diffStatus === 'edited' && 'bg-orange-50/50 ring-2 ring-orange-500 dark:bg-orange-900/10',
          // Deleted block highlighting (in original workflow)
          isDeletedBlock && 'bg-red-50/50 ring-2 ring-red-500 dark:bg-red-900/10'
        )}
      >
        {/* Show debug indicator for pending blocks */}
        {isPending && (
          <div className='-top-6 -translate-x-1/2 absolute left-1/2 z-10 transform rounded-t-md bg-amber-500 px-2 py-0.5 text-white text-xs'>
            Next Step
          </div>
        )}

        <ActionBar blockId={id} blockType={type} disabled={!userPermissions.canEdit} />
        {/* Connection Blocks - Don't show for trigger blocks, starter blocks, or blocks in trigger mode */}
        {config.category !== 'triggers' && type !== 'starter' && !displayTriggerMode && (
          <ConnectionBlocks
            blockId={id}
            isDisabled={!userPermissions.canEdit}
            horizontalHandles={horizontalHandles}
          />
        )}

        {/* Input Handle - Don't show for trigger blocks, starter blocks, or blocks in trigger mode */}
        {config.category !== 'triggers' && type !== 'starter' && !displayTriggerMode && (
          <Handle
            type='target'
            position={horizontalHandles ? Position.Left : Position.Top}
            id='target'
            className={cn(
              '!z-[30] !cursor-crosshair !border-none !bg-[#434343] !transition-[colors] !duration-150',
              horizontalHandles
                ? '!left-[-7px] !h-5 !w-[7px] !rounded-l-[2px] !rounded-r-none hover:!left-[-10px] hover:!w-[10px] hover:!rounded-l-full'
                : '!top-[-7px] !h-[7px] !w-5 !rounded-t-[2px] !rounded-b-none hover:!top-[-10px] hover:!h-[10px] hover:!rounded-t-full'
            )}
            style={{
              ...(horizontalHandles
                ? { top: '20px', transform: 'translateY(-50%)' }
                : { left: '50%', transform: 'translateX(-50%)' }),
            }}
            data-nodeid={id}
            data-handleid='target'
            isConnectableStart={false}
            isConnectableEnd={true}
            isValidConnection={(connection) => connection.source !== id}
          />
        )}

        {/* Block Header */}
        <div
          className='workflow-drag-handle flex cursor-grab items-center justify-between border-[#393939] border-b px-[9px] py-[8px] [&:active]:cursor-grabbing'
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
              className={cn('font-medium text-[16px]', !isEnabled && 'truncate text-[#808080]')}
              onClick={handleNameClick}
              title={name}
            >
              {name}
            </span>
          </div>
          <div className='flex flex-shrink-0 items-center gap-2'>
            {isWorkflowSelector && childWorkflowId && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <div className='relative mr-1 flex items-center justify-center'>
                    <div
                      className={cn(
                        'h-2.5 w-2.5 rounded-full',
                        childIsDeployed ? 'bg-green-500' : 'bg-red-500'
                      )}
                    />
                  </div>
                </Tooltip.Trigger>
                <Tooltip.Content side='top' className='px-3 py-2'>
                  <span className='text-sm'>
                    {childIsDeployed
                      ? isLoadingChildVersion
                        ? 'Deployed'
                        : childActiveVersion != null
                          ? `Deployed (v${childActiveVersion})`
                          : 'Deployed'
                      : 'Not Deployed'}
                  </span>
                </Tooltip.Content>
              </Tooltip.Root>
            )}
            {!isEnabled && (
              <Badge variant='secondary' className='bg-gray-100 text-gray-500 hover:bg-gray-100'>
                Disabled
              </Badge>
            )}
            {/* Schedule indicator badge - displayed for starter blocks with active schedules */}
            {shouldShowScheduleBadge && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Badge
                    variant='outline'
                    className={cn(
                      'flex cursor-pointer items-center gap-1 font-normal text-xs',
                      scheduleInfo?.isDisabled
                        ? 'border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400'
                        : 'border-green-200 bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400'
                    )}
                    onClick={
                      scheduleInfo?.id
                        ? scheduleInfo.isDisabled
                          ? () => reactivateSchedule(scheduleInfo.id!)
                          : () => disableSchedule(scheduleInfo.id!)
                        : undefined
                    }
                  >
                    <div className='relative mr-0.5 flex items-center justify-center'>
                      <div
                        className={cn(
                          'absolute h-3 w-3 rounded-full',
                          scheduleInfo?.isDisabled ? 'bg-amber-500/20' : 'bg-green-500/20'
                        )}
                      />
                      <div
                        className={cn(
                          'relative h-2 w-2 rounded-full',
                          scheduleInfo?.isDisabled ? 'bg-amber-500' : 'bg-green-500'
                        )}
                      />
                    </div>
                    {scheduleInfo?.isDisabled ? 'Disabled' : 'Scheduled'}
                  </Badge>
                </Tooltip.Trigger>
                <Tooltip.Content side='top' className='max-w-[300px] p-4'>
                  {scheduleInfo?.isDisabled ? (
                    <p className='text-sm'>
                      This schedule is currently disabled. Click the badge to reactivate it.
                    </p>
                  ) : (
                    <p className='text-sm'>Click the badge to disable this schedule.</p>
                  )}
                </Tooltip.Content>
              </Tooltip.Root>
            )}
            {/* Webhook indicator badge - displayed for starter blocks with active webhooks */}
            {showWebhookIndicator && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Badge
                    variant='outline'
                    className='flex items-center gap-1 border-green-200 bg-green-50 font-normal text-green-600 text-xs hover:bg-green-50 dark:bg-green-900/20 dark:text-green-400'
                  >
                    <div className='relative mr-0.5 flex items-center justify-center'>
                      <div className='absolute h-3 w-3 rounded-full bg-green-500/20' />
                      <div className='relative h-2 w-2 rounded-full bg-green-500' />
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

        {/* Subblocks Section */}
        {subBlockRows.length > 0 && (
          <div className='flex flex-col gap-[8px] p-[8px]'>
            {subBlockRows.map((row, rowIndex) =>
              row.map((subBlock) => {
                const subBlockValue = subBlockState[subBlock.id]?.value
                const displayValue =
                  subBlockValue != null && subBlockValue !== '' ? String(subBlockValue) : '-'

                return (
                  <div key={`${subBlock.id}-${rowIndex}`} className='flex items-start gap-[8px]'>
                    <span className='flex-shrink-0 text-[#AEAEAE] text-[14px]'>
                      {subBlock.title}
                    </span>
                    <span
                      className='flex-1 truncate text-right text-[#FFFFFF] text-[14px]'
                      title={displayValue}
                    >
                      {displayValue}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* Output Handle */}
        {type !== 'condition' && type !== 'response' && (
          <>
            <Handle
              type='source'
              position={horizontalHandles ? Position.Right : Position.Bottom}
              id='source'
              className={cn(
                '!z-[30] !cursor-crosshair !border-none !bg-[#434343] !transition-[colors] !duration-150',
                horizontalHandles
                  ? '!right-[-7px] !h-5 !w-[7px] !rounded-r-[2px] !rounded-l-none hover:!right-[-10px] hover:!w-[10px] hover:!rounded-r-full'
                  : '!bottom-[-7px] !h-[7px] !w-5 !rounded-b-[2px] !rounded-t-none hover:!bottom-[-10px] hover:!h-[10px] hover:!rounded-b-full'
              )}
              style={{
                ...(horizontalHandles
                  ? { top: '20px', transform: 'translateY(-50%)' }
                  : { left: '50%', transform: 'translateX(-50%)' }),
              }}
              data-nodeid={id}
              data-handleid='source'
              isConnectableStart={true}
              isConnectableEnd={false}
              isValidConnection={(connection) => connection.target !== id}
            />

            {/* Error Handle - Don't show for trigger blocks, starter blocks, or blocks in trigger mode */}
            {config.category !== 'triggers' && type !== 'starter' && !displayTriggerMode && (
              <Handle
                type='source'
                position={horizontalHandles ? Position.Right : Position.Bottom}
                id='error'
                className={cn(
                  '!z-[30] !cursor-crosshair !border-none !bg-red-400 !transition-[colors] !duration-150 dark:!bg-red-500',
                  horizontalHandles
                    ? '!h-5 !w-[7px] !rounded-r-[2px] !rounded-l-none hover:!right-[-10px] hover:!w-[10px] hover:!rounded-r-full'
                    : '!h-[7px] !w-5 !rounded-b-[2px] !rounded-t-none hover:!bottom-[-10px] hover:!h-[10px] hover:!rounded-b-full'
                )}
                style={{
                  position: 'absolute',
                  ...(horizontalHandles
                    ? {
                        right: '-7px',
                        top: 'auto',
                        bottom: '20px',
                        transform: 'translateY(50%)',
                      }
                    : {
                        bottom: '-7px',
                        left: 'auto',
                        right: '20px',
                        transform: 'translateX(50%)',
                      }),
                }}
                data-nodeid={id}
                data-handleid='error'
                isConnectableStart={true}
                isConnectableEnd={false}
                isValidConnection={(connection) => connection.target !== id}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}, shouldSkipBlockRender)
