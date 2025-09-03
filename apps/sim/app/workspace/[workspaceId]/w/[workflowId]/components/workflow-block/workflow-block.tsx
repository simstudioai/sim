import { useEffect, useRef, useState } from 'react'
import { BookOpen, Code, Info, RectangleHorizontal, RectangleVertical, Zap } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Handle, type NodeProps, Position, useUpdateNodeInternals } from 'reactflow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getEnv, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { parseCronToHumanReadable } from '@/lib/schedules/utils'
import { cn, validateName } from '@/lib/utils'
import { type DiffStatus, hasDiffStatus } from '@/lib/workflows/diff/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import type { BlockConfig, SubBlockConfig, SubBlockType } from '@/blocks/types'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useCurrentWorkflow } from '../../hooks'
import { ActionBar } from './components/action-bar/action-bar'
import { ConnectionBlocks } from './components/connection-blocks/connection-blocks'
import { SubBlock } from './components/sub-block/sub-block'

const logger = createLogger('WorkflowBlock')

interface WorkflowBlockProps {
  type: string
  config: BlockConfig
  name: string
  isActive?: boolean
  isPending?: boolean
  isPreview?: boolean
  subBlockValues?: Record<string, any>
  blockState?: any // Block state data passed in preview mode
}

// Combine both interfaces into a single component
export function WorkflowBlock({ id, data }: NodeProps<WorkflowBlockProps>) {
  const { type, config, name, isActive: dataIsActive, isPending } = data

  // State management
  const [isConnecting, setIsConnecting] = useState(false)

  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [isLoadingScheduleInfo, setIsLoadingScheduleInfo] = useState(false)
  const [scheduleInfo, setScheduleInfo] = useState<{
    scheduleTiming: string
    nextRunAt: string | null
    lastRanAt: string | null
    timezone: string
    status?: string
    isDisabled?: boolean
    id?: string
  } | null>(null)
  const [webhookInfo, setWebhookInfo] = useState<{
    webhookPath: string
    provider: string
  } | null>(null)

  // Refs
  const blockRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const updateNodeInternals = useUpdateNodeInternals()

  // Workflow store selectors
  const lastUpdate = useWorkflowStore((state) => state.lastUpdate)

  // Use the clean abstraction for current workflow state
  const currentWorkflow = useCurrentWorkflow()
  const currentBlock = currentWorkflow.getBlockById(id)

  // In preview mode, use the blockState provided; otherwise use current workflow state
  const isEnabled = data.isPreview
    ? (data.blockState?.enabled ?? true)
    : (currentBlock?.enabled ?? true)

  // Get diff status from the block itself (set by diff engine)
  const diffStatus: DiffStatus =
    currentWorkflow.isDiffMode && currentBlock && hasDiffStatus(currentBlock)
      ? currentBlock.is_diff
      : undefined

  // Get field-level diff information for this specific block from the diff store
  const diffAnalysisForFields = useWorkflowDiffStore((state) => state.diffAnalysis)
  const fieldDiff = currentWorkflow.isDiffMode
    ? diffAnalysisForFields?.field_diffs?.[id]
    : undefined

  // Debug: Log diff status for this block
  useEffect(() => {
    if (currentWorkflow.isDiffMode) {
      console.log(`[WorkflowBlock ${id}] Diff status:`, {
        blockId: id,
        blockName: currentBlock?.name,
        isDiffMode: currentWorkflow.isDiffMode,
        diffStatus,
        hasFieldDiff: !!fieldDiff,
        timestamp: Date.now(),
      })
    }
  }, [id, currentWorkflow.isDiffMode, diffStatus, fieldDiff, currentBlock?.name])

  // Check if this block is marked for deletion (in original workflow, not diff)
  const diffAnalysis = useWorkflowDiffStore((state) => state.diffAnalysis)
  const isShowingDiff = useWorkflowDiffStore((state) => state.isShowingDiff)
  const isDeletedBlock = !isShowingDiff && diffAnalysis?.deleted_blocks?.includes(id)

  // Debug: Log when in diff mode or when blocks are marked for deletion
  useEffect(() => {
    if (currentWorkflow.isDiffMode) {
      console.log(
        `[WorkflowBlock ${id}] Diff mode active, block exists: ${!!currentBlock}, diff status: ${diffStatus}`
      )
      if (fieldDiff) {
        console.log(`[WorkflowBlock ${id}] Field diff:`, fieldDiff)
      }
    }
    if (diffAnalysis && !isShowingDiff) {
      console.log(`[WorkflowBlock ${id}] Diff analysis available in original workflow:`, {
        deleted_blocks: diffAnalysis.deleted_blocks,
        isDeletedBlock,
        isShowingDiff,
      })
    }
    if (isDeletedBlock) {
      console.log(`[WorkflowBlock ${id}] Block marked for deletion in original workflow`)
    }
  }, [
    currentWorkflow.isDiffMode,
    currentBlock,
    diffStatus,
    fieldDiff || null,
    isDeletedBlock,
    diffAnalysis,
    isShowingDiff,
    id,
  ])
  const horizontalHandles = data.isPreview
    ? (data.blockState?.horizontalHandles ?? true) // In preview mode, use blockState and default to horizontal
    : useWorkflowStore((state) => state.blocks[id]?.horizontalHandles ?? true) // Changed default to true for consistency
  const isWide = useWorkflowStore((state) => state.blocks[id]?.isWide ?? false)
  const blockHeight = useWorkflowStore((state) => state.blocks[id]?.height ?? 0)
  // Get per-block webhook status by checking if webhook is configured
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  const hasWebhookProvider = useSubBlockStore(
    (state) => state.workflowValues[activeWorkflowId || '']?.[id]?.webhookProvider
  )
  const hasWebhookPath = useSubBlockStore(
    (state) => state.workflowValues[activeWorkflowId || '']?.[id]?.webhookPath
  )
  const blockWebhookStatus = !!(hasWebhookProvider && hasWebhookPath)

  const blockAdvancedMode = useWorkflowStore((state) => state.blocks[id]?.advancedMode ?? false)
  const blockTriggerMode = useWorkflowStore((state) => state.blocks[id]?.triggerMode ?? false)

  // Local UI state for diff mode controls
  const [diffIsWide, setDiffIsWide] = useState<boolean>(isWide)
  const [diffAdvancedMode, setDiffAdvancedMode] = useState<boolean>(blockAdvancedMode)
  const [diffTriggerMode, setDiffTriggerMode] = useState<boolean>(blockTriggerMode)

  useEffect(() => {
    if (currentWorkflow.isDiffMode) {
      setDiffIsWide(isWide)
      setDiffAdvancedMode(blockAdvancedMode)
      setDiffTriggerMode(blockTriggerMode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkflow.isDiffMode, id])

  const displayIsWide = currentWorkflow.isDiffMode ? diffIsWide : isWide
  const displayAdvancedMode = currentWorkflow.isDiffMode ? diffAdvancedMode : blockAdvancedMode
  const displayTriggerMode = currentWorkflow.isDiffMode ? diffTriggerMode : blockTriggerMode

  // Collaborative workflow actions
  const {
    collaborativeUpdateBlockName,
    collaborativeToggleBlockWide,
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
  const updateBlockHeight = useWorkflowStore((state) => state.updateBlockHeight)

  // Execution store
  const isActiveBlock = useExecutionStore((state) => state.activeBlockIds.has(id))
  const isActive = dataIsActive || isActiveBlock

  // Get the current workflow ID from URL params instead of global state
  // This prevents race conditions when switching workflows rapidly
  const params = useParams()
  const currentWorkflowId = params.workflowId as string

  // Check if this is a starter block or trigger block
  const isStarterBlock = type === 'starter'
  const isTriggerBlock = config.category === 'triggers'
  const isWebhookTriggerBlock = type === 'webhook'

  const reactivateSchedule = async (scheduleId: string) => {
    try {
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'reactivate' }),
      })

      if (response.ok) {
        // Use the current workflow ID from params instead of global state
        if (currentWorkflowId) {
          fetchScheduleInfo(currentWorkflowId)
        }
      } else {
        logger.error('Failed to reactivate schedule')
      }
    } catch (error) {
      logger.error('Error reactivating schedule:', error)
    }
  }

  const disableSchedule = async (scheduleId: string) => {
    try {
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'disable' }),
      })

      if (response.ok) {
        // Refresh schedule info to show updated status
        if (currentWorkflowId) {
          fetchScheduleInfo(currentWorkflowId)
        }
      } else {
        logger.error('Failed to disable schedule')
      }
    } catch (error) {
      logger.error('Error disabling schedule:', error)
    }
  }

  const fetchScheduleInfo = async (workflowId: string) => {
    if (!workflowId) return

    try {
      setIsLoadingScheduleInfo(true)

      // For schedule trigger blocks, always include the blockId parameter
      const url = new URL('/api/schedules', window.location.origin)
      url.searchParams.set('workflowId', workflowId)
      url.searchParams.set('mode', 'schedule')
      url.searchParams.set('blockId', id) // Always include blockId for schedule blocks

      const response = await fetch(url.toString(), {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      })

      if (!response.ok) {
        setScheduleInfo(null)
        return
      }

      const data = await response.json()

      if (!data.schedule) {
        setScheduleInfo(null)
        return
      }

      let scheduleTiming = 'Unknown schedule'
      if (data.schedule.cronExpression) {
        scheduleTiming = parseCronToHumanReadable(data.schedule.cronExpression)
      }

      const baseInfo = {
        scheduleTiming,
        nextRunAt: data.schedule.nextRunAt as string | null,
        lastRanAt: data.schedule.lastRanAt as string | null,
        timezone: data.schedule.timezone || 'UTC',
        status: data.schedule.status as string,
        isDisabled: data.schedule.status === 'disabled',
        id: data.schedule.id as string,
      }

      try {
        const statusRes = await fetch(`/api/schedules/${baseInfo.id}/status`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        })

        if (statusRes.ok) {
          const statusData = await statusRes.json()
          setScheduleInfo({
            scheduleTiming: baseInfo.scheduleTiming,
            nextRunAt: statusData.nextRunAt ?? baseInfo.nextRunAt,
            lastRanAt: statusData.lastRanAt ?? baseInfo.lastRanAt,
            timezone: baseInfo.timezone,
            status: statusData.status ?? baseInfo.status,
            isDisabled: statusData.isDisabled ?? baseInfo.isDisabled,
            id: baseInfo.id,
          })
          return
        }
      } catch (err) {
        logger.error('Error fetching schedule status:', err)
      }

      setScheduleInfo(baseInfo)
    } catch (error) {
      logger.error('Error fetching schedule info:', error)
      setScheduleInfo(null)
    } finally {
      setIsLoadingScheduleInfo(false)
    }
  }

  useEffect(() => {
    if (type === 'schedule' && currentWorkflowId) {
      fetchScheduleInfo(currentWorkflowId)
    } else {
      setScheduleInfo(null)
      setIsLoadingScheduleInfo(false) // Reset loading state when not a schedule block
    }

    // Cleanup function to reset loading state when component unmounts or workflow changes
    return () => {
      setIsLoadingScheduleInfo(false)
    }
  }, [isStarterBlock, isTriggerBlock, type, currentWorkflowId, lastUpdate])

  // Get webhook information for the tooltip
  useEffect(() => {
    if (!blockWebhookStatus) {
      setWebhookInfo(null)
    }
  }, [blockWebhookStatus])

  // Update node internals when handles change
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, horizontalHandles, updateNodeInternals])

  const debounce = (func: (...args: any[]) => void, wait: number) => {
    let timeout: NodeJS.Timeout
    return (...args: any[]) => {
      clearTimeout(timeout)
      timeout = setTimeout(() => func(...args), wait)
    }
  }

  // Add effect to observe size changes with debounced updates
  useEffect(() => {
    if (!contentRef.current) return

    let rafId: number
    const debouncedUpdate = debounce((height: number) => {
      if (height !== blockHeight) {
        updateBlockHeight(id, height)
        updateNodeInternals(id)
      }
    }, 100)

    const resizeObserver = new ResizeObserver((entries) => {
      // Cancel any pending animation frame
      if (rafId) {
        cancelAnimationFrame(rafId)
      }

      // Schedule the update on the next animation frame
      rafId = requestAnimationFrame(() => {
        for (const entry of entries) {
          const height =
            entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height
          debouncedUpdate(height)
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
  }, [id, blockHeight, updateBlockHeight, updateNodeInternals, lastUpdate])

  // SubBlock layout management
  function groupSubBlocks(subBlocks: SubBlockConfig[], blockId: string) {
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
      // In normal mode, use merged state
      const blocks = useWorkflowStore.getState().blocks
      const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId || undefined
      const mergedState = mergeSubblockState(blocks, activeWorkflowId, blockId)[blockId]
      stateToUse = mergedState?.subBlocks || {}
    }

    const isAdvancedMode = useWorkflowStore.getState().blocks[blockId]?.advancedMode ?? false
    const isTriggerMode = useWorkflowStore.getState().blocks[blockId]?.triggerMode ?? false
    const effectiveAdvanced = currentWorkflow.isDiffMode ? displayAdvancedMode : isAdvancedMode
    const effectiveTrigger = currentWorkflow.isDiffMode ? displayTriggerMode : isTriggerMode
    const e2bClientEnabled = isTruthy(getEnv('NEXT_PUBLIC_E2B_ENABLED'))

    // Filter visible blocks and those that meet their conditions
    const visibleSubBlocks = subBlocks.filter((block) => {
      if (block.hidden) return false

      // Filter out E2B-related blocks if E2B is not enabled on the client
      if (!e2bClientEnabled && (block.id === 'remoteExecution' || block.id === 'language')) {
        return false
      }

      // Special handling for trigger mode
      if (block.type === ('trigger-config' as SubBlockType)) {
        // Show trigger-config blocks when in trigger mode OR for pure trigger blocks
        const isPureTriggerBlock = config?.triggers?.enabled && config.category === 'triggers'
        return effectiveTrigger || isPureTriggerBlock
      }

      if (effectiveTrigger && block.type !== ('trigger-config' as SubBlockType)) {
        // In trigger mode, hide all non-trigger-config blocks
        return false
      }

      // Filter by mode if specified
      if (block.mode) {
        if (block.mode === 'basic' && effectiveAdvanced) return false
        if (block.mode === 'advanced' && !effectiveAdvanced) return false
      }

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
      const blockWidth = block.layout === 'half' ? 0.5 : 1
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

    return rows
  }

  const subBlockRows = groupSubBlocks(config.subBlocks, id)

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
    setEditedName(validatedName.slice(0, 18))
  }

  const handleNameSubmit = () => {
    const trimmedName = editedName.trim().slice(0, 18)
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
  const showWebhookIndicator = (isStarterBlock || isWebhookTriggerBlock) && blockWebhookStatus

  const getProviderName = (providerId: string): string => {
    const providers: Record<string, string> = {
      whatsapp: 'WhatsApp',
      github: 'GitHub',
      discord: 'Discord',
      stripe: 'Stripe',
      generic: 'General',
      slack: 'Slack',
      airtable: 'Airtable',
      gmail: 'Gmail',
    }
    return providers[providerId] || 'Webhook'
  }

  const shouldShowScheduleBadge =
    type === 'schedule' && !isLoadingScheduleInfo && scheduleInfo !== null
  const userPermissions = useUserPermissionsContext()

  return (
    <div className='group relative'>
      <Card
        ref={blockRef}
        className={cn(
          'relative cursor-default select-none shadow-md',
          'transition-block-bg transition-ring',
          displayIsWide ? 'w-[480px]' : 'w-[320px]',
          !isEnabled && 'shadow-sm',
          isActive && 'animate-pulse-ring ring-2 ring-blue-500',
          isPending && 'ring-2 ring-amber-500',
          // Diff highlighting
          diffStatus === 'new' && 'bg-green-50/50 ring-2 ring-green-500 dark:bg-green-900/10',
          diffStatus === 'edited' && 'bg-orange-50/50 ring-2 ring-orange-500 dark:bg-orange-900/10',
          // Deleted block highlighting (in original workflow)
          isDeletedBlock && 'bg-red-50/50 ring-2 ring-red-500 dark:bg-red-900/10',
          'z-[20]'
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
        {config.category !== 'triggers' && type !== 'starter' && !blockTriggerMode && (
          <ConnectionBlocks
            blockId={id}
            setIsConnecting={setIsConnecting}
            isDisabled={!userPermissions.canEdit}
            horizontalHandles={horizontalHandles}
          />
        )}

        {/* Input Handle - Don't show for trigger blocks, starter blocks, or blocks in trigger mode */}
        {config.category !== 'triggers' && type !== 'starter' && !blockTriggerMode && (
          <Handle
            type='target'
            position={horizontalHandles ? Position.Left : Position.Top}
            id='target'
            className={cn(
              horizontalHandles ? '!w-[7px] !h-5' : '!w-5 !h-[7px]',
              '!bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none',
              '!z-[30]',
              'group-hover:!shadow-[0_0_0_3px_rgba(156,163,175,0.15)]',
              horizontalHandles
                ? 'hover:!w-[10px] hover:!left-[-10px] hover:!rounded-l-full hover:!rounded-r-none'
                : 'hover:!h-[10px] hover:!top-[-10px] hover:!rounded-t-full hover:!rounded-b-none',
              '!cursor-crosshair',
              'transition-[colors] duration-150',
              horizontalHandles ? '!left-[-7px]' : '!top-[-7px]'
            )}
            style={{
              ...(horizontalHandles
                ? { top: '50%', transform: 'translateY(-50%)' }
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
          className='workflow-drag-handle flex cursor-grab items-center justify-between border-b p-3 [&:active]:cursor-grabbing'
          onMouseDown={(e) => {
            e.stopPropagation()
          }}
        >
          <div className='flex min-w-0 flex-1 items-center gap-3'>
            <div
              className='flex h-7 w-7 flex-shrink-0 items-center justify-center rounded'
              style={{ backgroundColor: isEnabled ? config.bgColor : 'gray' }}
            >
              <config.icon className='h-5 w-5 text-white' />
            </div>
            <div className='min-w-0'>
              {isEditing ? (
                <input
                  ref={nameInputRef}
                  type='text'
                  value={editedName}
                  onChange={(e) => handleNodeNameChange(e.target.value)}
                  onBlur={handleNameSubmit}
                  onKeyDown={handleNameKeyDown}
                  className='border-none bg-transparent p-0 font-medium text-md outline-none'
                  maxLength={18}
                />
              ) : (
                <span
                  className={cn(
                    'inline-block cursor-text font-medium text-md hover:text-muted-foreground',
                    !isEnabled && 'text-muted-foreground'
                  )}
                  onClick={handleNameClick}
                  title={name}
                  style={{
                    maxWidth: !isEnabled ? (displayIsWide ? '200px' : '140px') : '180px',
                  }}
                >
                  {name}
                </span>
              )}
            </div>
          </div>
          <div className='flex flex-shrink-0 items-center gap-2'>
            {!isEnabled && (
              <Badge variant='secondary' className='bg-gray-100 text-gray-500 hover:bg-gray-100'>
                Disabled
              </Badge>
            )}
            {/* Schedule indicator badge - displayed for starter blocks with active schedules */}
            {shouldShowScheduleBadge && (
              <Tooltip>
                <TooltipTrigger asChild>
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
                </TooltipTrigger>
                <TooltipContent side='top' className='max-w-[300px] p-4'>
                  {scheduleInfo?.isDisabled ? (
                    <p className='text-sm'>
                      This schedule is currently disabled. Click the badge to reactivate it.
                    </p>
                  ) : (
                    <p className='text-sm'>Click the badge to disable this schedule.</p>
                  )}
                </TooltipContent>
              </Tooltip>
            )}
            {/* Webhook indicator badge - displayed for starter blocks with active webhooks */}
            {showWebhookIndicator && (
              <Tooltip>
                <TooltipTrigger asChild>
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
                </TooltipTrigger>
                <TooltipContent side='top' className='max-w-[300px] p-4'>
                  {webhookInfo ? (
                    <>
                      <p className='text-sm'>{getProviderName(webhookInfo.provider)} Webhook</p>
                      <p className='mt-1 text-muted-foreground text-xs'>
                        Path: {webhookInfo.webhookPath}
                      </p>
                    </>
                  ) : (
                    <p className='text-muted-foreground text-sm'>
                      This workflow is triggered by a webhook.
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            )}
            {config.subBlocks.some((block) => block.mode) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => {
                      if (currentWorkflow.isDiffMode) {
                        setDiffAdvancedMode((prev) => !prev)
                      } else if (userPermissions.canEdit) {
                        collaborativeToggleBlockAdvancedMode(id)
                      }
                    }}
                    className={cn(
                      'h-7 p-1 text-gray-500',
                      displayAdvancedMode && 'text-[var(--brand-primary-hex)]',
                      !userPermissions.canEdit &&
                        !currentWorkflow.isDiffMode &&
                        'cursor-not-allowed opacity-50'
                    )}
                    disabled={!userPermissions.canEdit && !currentWorkflow.isDiffMode}
                  >
                    <Code className='h-5 w-5' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='top'>
                  {!userPermissions.canEdit && !currentWorkflow.isDiffMode
                    ? userPermissions.isOfflineMode
                      ? 'Connection lost - please refresh'
                      : 'Read-only mode'
                    : displayAdvancedMode
                      ? 'Switch to Basic Mode'
                      : 'Switch to Advanced Mode'}
                </TooltipContent>
              </Tooltip>
            )}
            {/* Trigger Mode Button - Show for hybrid blocks that support triggers (not pure trigger blocks) */}
            {config.triggers?.enabled && config.category !== 'triggers' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => {
                      if (currentWorkflow.isDiffMode) {
                        setDiffTriggerMode((prev) => !prev)
                      } else if (userPermissions.canEdit) {
                        // Toggle trigger mode using collaborative function
                        collaborativeToggleBlockTriggerMode(id)
                      }
                    }}
                    className={cn(
                      'h-7 p-1 text-gray-500',
                      displayTriggerMode && 'text-[#22C55E]',
                      !userPermissions.canEdit &&
                        !currentWorkflow.isDiffMode &&
                        'cursor-not-allowed opacity-50'
                    )}
                    disabled={!userPermissions.canEdit && !currentWorkflow.isDiffMode}
                  >
                    <Zap className='h-5 w-5' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='top'>
                  {!userPermissions.canEdit && !currentWorkflow.isDiffMode
                    ? userPermissions.isOfflineMode
                      ? 'Connection lost - please refresh'
                      : 'Read-only mode'
                    : displayTriggerMode
                      ? 'Switch to Action Mode'
                      : 'Switch to Trigger Mode'}
                </TooltipContent>
              </Tooltip>
            )}
            {config.docsLink ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-7 p-1 text-gray-500'
                    onClick={(e) => {
                      e.stopPropagation()
                      window.open(config.docsLink, '_target', 'noopener,noreferrer')
                    }}
                  >
                    <BookOpen className='h-5 w-5' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='top'>See Docs</TooltipContent>
              </Tooltip>
            ) : (
              config.longDescription && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant='ghost' size='sm' className='h-7 p-1 text-gray-500'>
                      <Info className='h-5 w-5' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side='top' className='max-w-[300px] p-4'>
                    <div className='space-y-3'>
                      <div>
                        <p className='mb-1 font-medium text-sm'>Description</p>
                        <p className='text-muted-foreground text-sm'>{config.longDescription}</p>
                      </div>
                      {config.outputs && (
                        <div>
                          <p className='mb-1 font-medium text-sm'>Output</p>
                          <div className='text-sm'>
                            {Object.entries(config.outputs).map(([key, value]) => (
                              <div key={key} className='mb-1'>
                                <span className='text-muted-foreground'>{key}</span>{' '}
                                {typeof value === 'object' && value !== null && 'type' in value ? (
                                  // New format: { type: 'string', description: '...' }
                                  <span className='text-green-500'>{value.type}</span>
                                ) : typeof value === 'object' && value !== null ? (
                                  // Legacy complex object format
                                  <div className='mt-1 pl-3'>
                                    {Object.entries(value).map(([typeKey, typeValue]) => (
                                      <div key={typeKey} className='flex items-start'>
                                        <span className='font-medium text-blue-500'>
                                          {typeKey}:
                                        </span>
                                        <span className='ml-1 text-green-500'>
                                          {typeValue as string}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  // Old format: just a string
                                  <span className='text-green-500'>{value as string}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => {
                    if (currentWorkflow.isDiffMode) {
                      setDiffIsWide((prev) => !prev)
                    } else if (userPermissions.canEdit) {
                      collaborativeToggleBlockWide(id)
                    }
                  }}
                  className={cn(
                    'h-7 p-1 text-gray-500',
                    !userPermissions.canEdit &&
                      !currentWorkflow.isDiffMode &&
                      'cursor-not-allowed opacity-50'
                  )}
                  disabled={!userPermissions.canEdit && !currentWorkflow.isDiffMode}
                >
                  {displayIsWide ? (
                    <RectangleHorizontal className='h-5 w-5' />
                  ) : (
                    <RectangleVertical className='h-5 w-5' />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side='top'>
                {!userPermissions.canEdit && !currentWorkflow.isDiffMode
                  ? userPermissions.isOfflineMode
                    ? 'Connection lost - please refresh'
                    : 'Read-only mode'
                  : displayIsWide
                    ? 'Narrow Block'
                    : 'Expand Block'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Block Content */}
        <div
          ref={contentRef}
          className='cursor-pointer space-y-4 px-4 pt-3 pb-4'
          onMouseDown={(e) => {
            e.stopPropagation()
          }}
        >
          {subBlockRows.length > 0
            ? subBlockRows.map((row, rowIndex) => (
                <div key={`row-${rowIndex}`} className='flex gap-4'>
                  {row.map((subBlock, blockIndex) => (
                    <div
                      key={`${id}-${rowIndex}-${blockIndex}`}
                      className={cn('space-y-1', subBlock.layout === 'half' ? 'flex-1' : 'w-full')}
                    >
                      <SubBlock
                        blockId={id}
                        config={subBlock}
                        isConnecting={isConnecting}
                        isPreview={data.isPreview || currentWorkflow.isDiffMode}
                        subBlockValues={
                          data.subBlockValues ||
                          (currentWorkflow.isDiffMode && currentBlock
                            ? (currentBlock as any).subBlocks
                            : undefined)
                        }
                        disabled={!userPermissions.canEdit}
                        fieldDiffStatus={
                          fieldDiff?.changed_fields?.includes(subBlock.id)
                            ? 'changed'
                            : fieldDiff?.unchanged_fields?.includes(subBlock.id)
                              ? 'unchanged'
                              : undefined
                        }
                        allowExpandInPreview={currentWorkflow.isDiffMode}
                        isWide={displayIsWide}
                      />
                    </div>
                  ))}
                </div>
              ))
            : null}
        </div>

        {/* Output Handle */}
        {type !== 'condition' && type !== 'response' && (
          <>
            <Handle
              type='source'
              position={horizontalHandles ? Position.Right : Position.Bottom}
              id='source'
              className={cn(
                horizontalHandles ? '!w-[7px] !h-5' : '!w-5 !h-[7px]',
                '!bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none',
                '!z-[30]',
                'group-hover:!shadow-[0_0_0_3px_rgba(156,163,175,0.15)]',
                horizontalHandles
                  ? 'hover:!w-[10px] hover:!right-[-10px] hover:!rounded-r-full hover:!rounded-l-none'
                  : 'hover:!h-[10px] hover:!bottom-[-10px] hover:!rounded-b-full hover:!rounded-t-none',
                '!cursor-crosshair',
                'transition-[colors] duration-150',
                horizontalHandles ? '!right-[-7px]' : '!bottom-[-7px]'
              )}
              style={{
                ...(horizontalHandles
                  ? { top: '50%', transform: 'translateY(-50%)' }
                  : { left: '50%', transform: 'translateX(-50%)' }),
              }}
              data-nodeid={id}
              data-handleid='source'
              isConnectableStart={true}
              isConnectableEnd={false}
              isValidConnection={(connection) => connection.target !== id}
            />

            {/* Error Handle - Don't show for trigger blocks, starter blocks, or blocks in trigger mode */}
            {config.category !== 'triggers' && type !== 'starter' && !blockTriggerMode && (
              <Handle
                type='source'
                position={horizontalHandles ? Position.Right : Position.Bottom}
                id='error'
                className={cn(
                  horizontalHandles ? '!w-[7px] !h-5' : '!w-5 !h-[7px]',
                  '!bg-red-400 dark:!bg-red-500 !rounded-[2px] !border-none',
                  '!z-[30]',
                  'group-hover:!shadow-[0_0_0_3px_rgba(248,113,113,0.15)]',
                  horizontalHandles
                    ? 'hover:!w-[10px] hover:!right-[-10px] hover:!rounded-r-full hover:!rounded-l-none'
                    : 'hover:!h-[10px] hover:!bottom-[-10px] hover:!rounded-b-full hover:!rounded-t-none',
                  '!cursor-crosshair',
                  'transition-[colors] duration-150'
                )}
                style={{
                  position: 'absolute',
                  ...(horizontalHandles
                    ? {
                        right: '-8px',
                        top: 'auto',
                        bottom: '30px',
                        transform: 'translateY(0)',
                      }
                    : {
                        bottom: '-7px',
                        left: 'auto',
                        right: '30px',
                        transform: 'translateX(0)',
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
      </Card>
    </div>
  )
}
