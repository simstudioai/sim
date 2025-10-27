import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { useSubBlockValue } from './components/sub-block/hooks/use-sub-block-value'
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

// Combine both interfaces into a single component - wrapped in memo for performance
export const WorkflowBlock = memo(
  function WorkflowBlock({ id, data }: NodeProps<WorkflowBlockProps>) {
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

    // Optimized: Single diff store subscription for all diff-related data
    const { diffAnalysis, isShowingDiff, fieldDiff } = useWorkflowDiffStore(
      useCallback(
        (state) => ({
          diffAnalysis: state.diffAnalysis,
          isShowingDiff: state.isShowingDiff,
          fieldDiff: currentWorkflow.isDiffMode ? state.diffAnalysis?.field_diffs?.[id] : undefined,
        }),
        [id, currentWorkflow.isDiffMode]
      )
    )
    const isDeletedBlock = !isShowingDiff && diffAnalysis?.deleted_blocks?.includes(id)

    // Removed debug logging for performance
    // Optimized: Single store subscription for all block properties
    const {
      storeHorizontalHandles,
      storeIsWide,
      storeBlockHeight,
      storeBlockLayout,
      storeBlockAdvancedMode,
      storeBlockTriggerMode,
    } = useWorkflowStore(
      useCallback(
        (state) => {
          const block = state.blocks[id]
          return {
            storeHorizontalHandles: block?.horizontalHandles ?? true,
            storeIsWide: block?.isWide ?? false,
            storeBlockHeight: block?.height ?? 0,
            storeBlockLayout: block?.layout,
            storeBlockAdvancedMode: block?.advancedMode ?? false,
            storeBlockTriggerMode: block?.triggerMode ?? false,
          }
        },
        [id]
      )
    )

    // Get block properties from currentWorkflow when in diff mode, otherwise from workflow store
    const horizontalHandles = data.isPreview
      ? (data.blockState?.horizontalHandles ?? true) // In preview mode, use blockState and default to horizontal
      : currentWorkflow.isDiffMode
        ? (currentWorkflow.blocks[id]?.horizontalHandles ?? true)
        : storeHorizontalHandles

    const isWide = currentWorkflow.isDiffMode
      ? (currentWorkflow.blocks[id]?.isWide ?? false)
      : storeIsWide

    const blockHeight = currentWorkflow.isDiffMode
      ? (currentWorkflow.blocks[id]?.height ?? 0)
      : storeBlockHeight

    const blockWidth = currentWorkflow.isDiffMode
      ? (currentWorkflow.blocks[id]?.layout?.measuredWidth ?? 0)
      : (storeBlockLayout?.measuredWidth ?? 0)

    // Get per-block webhook status by checking if webhook is configured
    const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

    // Optimized: Single SubBlockStore subscription for webhook info
    const blockWebhookStatus = useSubBlockStore(
      useCallback(
        (state) => {
          const blockValues = state.workflowValues[activeWorkflowId || '']?.[id]
          return !!(blockValues?.webhookProvider && blockValues?.webhookPath)
        },
        [activeWorkflowId, id]
      )
    )

    const blockAdvancedMode = currentWorkflow.isDiffMode
      ? (currentWorkflow.blocks[id]?.advancedMode ?? false)
      : storeBlockAdvancedMode

    // Get triggerMode from currentWorkflow blocks when in diff mode, otherwise from workflow store
    const blockTriggerMode = currentWorkflow.isDiffMode
      ? (currentWorkflow.blocks[id]?.triggerMode ?? false)
      : storeBlockTriggerMode

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
    const displayAdvancedMode = currentWorkflow.isDiffMode
      ? diffAdvancedMode
      : data.isPreview
        ? (data.blockState?.advancedMode ?? false)
        : blockAdvancedMode
    const displayTriggerMode = currentWorkflow.isDiffMode
      ? diffTriggerMode
      : data.isPreview
        ? (data.blockState?.triggerMode ?? false)
        : blockTriggerMode

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
    const updateBlockLayoutMetrics = useWorkflowStore((state) => state.updateBlockLayoutMetrics)

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

    const fetchScheduleInfo = useCallback(
      async (workflowId: string) => {
        if (!workflowId) return

        try {
          setIsLoadingScheduleInfo(true)

          const params = new URLSearchParams({
            workflowId,
            mode: 'schedule',
            blockId: id,
          })

          const response = await fetch(`/api/schedules?${params}`, {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
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

          const schedule = data.schedule
          const scheduleTimezone = schedule.timezone || 'UTC'

          setScheduleInfo({
            scheduleTiming: schedule.cronExpression
              ? parseCronToHumanReadable(schedule.cronExpression, scheduleTimezone)
              : 'Unknown schedule',
            nextRunAt: schedule.nextRunAt,
            lastRanAt: schedule.lastRanAt,
            timezone: scheduleTimezone,
            status: schedule.status,
            isDisabled: schedule.status === 'disabled',
            id: schedule.id,
          })
        } catch (error) {
          logger.error('Error fetching schedule info:', error)
          setScheduleInfo(null)
        } finally {
          setIsLoadingScheduleInfo(false)
        }
      },
      [id]
    )

    useEffect(() => {
      if (type === 'schedule' && currentWorkflowId) {
        fetchScheduleInfo(currentWorkflowId)
      } else {
        setScheduleInfo(null)
        setIsLoadingScheduleInfo(false) // Reset loading state when not a schedule block
      }

      // Listen for schedule updates from the schedule-config component
      const handleScheduleUpdate = (event: CustomEvent) => {
        // Check if the update is for this workflow and block
        if (event.detail?.workflowId === currentWorkflowId && event.detail?.blockId === id) {
          logger.debug('Schedule update event received, refetching schedule info')
          if (type === 'schedule') {
            fetchScheduleInfo(currentWorkflowId)
          }
        }
      }

      window.addEventListener('schedule-updated', handleScheduleUpdate as EventListener)

      // Cleanup function to reset loading state and remove listener
      return () => {
        setIsLoadingScheduleInfo(false)
        window.removeEventListener('schedule-updated', handleScheduleUpdate as EventListener)
      }
    }, [type, currentWorkflowId, id, fetchScheduleInfo])

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

    // Memoized debounce function to avoid recreating on every render
    const debounce = useCallback((func: (...args: any[]) => void, wait: number) => {
      let timeout: NodeJS.Timeout
      return (...args: any[]) => {
        clearTimeout(timeout)
        timeout = setTimeout(() => func(...args), wait)
      }
    }, [])

    // Add effect to observe size changes with debounced updates
    useEffect(() => {
      if (!contentRef.current) return

      let rafId: number
      const debouncedUpdate = debounce((dimensions: { width: number; height: number }) => {
        if (dimensions.height !== blockHeight || dimensions.width !== blockWidth) {
          updateBlockLayoutMetrics(id, dimensions)
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
            const rect = entry.target.getBoundingClientRect()
            const height = entry.borderBoxSize[0]?.blockSize ?? rect.height
            const width = entry.borderBoxSize[0]?.inlineSize ?? rect.width
            debouncedUpdate({ width, height })
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
    }, [id, blockHeight, blockWidth, updateBlockLayoutMetrics, updateNodeInternals, debounce])

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

    const getSubBlockStableKey = useCallback(
      (subBlock: SubBlockConfig, stateToUse: Record<string, any>): string => {
        if (subBlock.type === 'mcp-dynamic-args') {
          const serverValue = stateToUse.server?.value || 'no-server'
          const toolValue = stateToUse.tool?.value || 'no-tool'
          return `${id}-${subBlock.id}-${serverValue}-${toolValue}`
        }

        if (subBlock.type === 'mcp-tool-selector') {
          const serverValue = stateToUse.server?.value || 'no-server'
          return `${id}-${subBlock.id}-${serverValue}`
        }

        return `${id}-${subBlock.id}`
      },
      [id]
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
        // In normal mode, use merged state
        const blocks = useWorkflowStore.getState().blocks
        const mergedState = mergeSubblockState(blocks, activeWorkflowId || undefined, id)[id]
        stateToUse = mergedState?.subBlocks || {}
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

      // Return both rows and state for stable key generation
      return { rows, stateToUse }
    }, [
      config.subBlocks,
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
    const registryDeploymentStatuses = useWorkflowRegistry((state) => state.deploymentStatuses)
    const [childActiveVersion, setChildActiveVersion] = useState<number | null>(null)
    const [childIsDeployed, setChildIsDeployed] = useState<boolean>(false)
    const [isLoadingChildVersion, setIsLoadingChildVersion] = useState(false)

    // Use the store directly for real-time updates when workflow dropdown changes
    const [workflowIdFromStore] = useSubBlockValue<string>(id, 'workflowId')

    // Determine if this is a workflow block (child workflow selector) and fetch child status
    const isWorkflowSelector = type === 'workflow' || type === 'workflow_input'
    let childWorkflowId: string | undefined
    if (!data.isPreview) {
      // Use store value for real-time updates
      const val = workflowIdFromStore
      if (typeof val === 'string' && val.trim().length > 0) {
        childWorkflowId = val
      }
    } else if (data.isPreview && data.subBlockValues?.workflowId?.value) {
      const val = data.subBlockValues.workflowId.value
      if (typeof val === 'string' && val.trim().length > 0) childWorkflowId = val
    }

    const childDeployment = childWorkflowId ? registryDeploymentStatuses[childWorkflowId] : null

    // Fetch active deployment version for the selected child workflow
    useEffect(() => {
      let cancelled = false
      const fetchActiveVersion = async (wfId: string) => {
        try {
          setIsLoadingChildVersion(true)
          const res = await fetch(`/api/workflows/${wfId}/deployments`, {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
          })
          if (!res.ok) {
            if (!cancelled) {
              setChildActiveVersion(null)
              setChildIsDeployed(false)
            }
            return
          }
          const json = await res.json()
          const versions = Array.isArray(json?.data?.versions)
            ? json.data.versions
            : Array.isArray(json?.versions)
              ? json.versions
              : []
          const active = versions.find((v: any) => v.isActive)
          if (!cancelled) {
            const v = active ? Number(active.version) : null
            setChildActiveVersion(v)
            setChildIsDeployed(v != null)
          }
        } catch {
          if (!cancelled) {
            setChildActiveVersion(null)
            setChildIsDeployed(false)
          }
        } finally {
          if (!cancelled) setIsLoadingChildVersion(false)
        }
      }

      // Always fetch when childWorkflowId changes
      if (childWorkflowId) {
        void fetchActiveVersion(childWorkflowId)
      } else {
        setChildActiveVersion(null)
        setChildIsDeployed(false)
      }
      return () => {
        cancelled = true
      }
    }, [childWorkflowId])

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
            diffStatus === 'edited' &&
              'bg-orange-50/50 ring-2 ring-orange-500 dark:bg-orange-900/10',
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
          {config.category !== 'triggers' && type !== 'starter' && !displayTriggerMode && (
            <ConnectionBlocks
              blockId={id}
              setIsConnecting={setIsConnecting}
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
            className={cn(
              'workflow-drag-handle flex cursor-grab items-center justify-between p-3 [&:active]:cursor-grabbing',
              subBlockRows.length > 0 && 'border-b'
            )}
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
              {isWorkflowSelector && childWorkflowId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className='relative mr-1 flex items-center justify-center'>
                      <div
                        className={cn(
                          'h-2.5 w-2.5 rounded-full',
                          childIsDeployed ? 'bg-green-500' : 'bg-red-500'
                        )}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side='top' className='px-3 py-2'>
                    <span className='text-sm'>
                      {childIsDeployed
                        ? isLoadingChildVersion
                          ? 'Deployed'
                          : childActiveVersion != null
                            ? `Deployed (v${childActiveVersion})`
                            : 'Deployed'
                        : 'Not Deployed'}
                    </span>
                  </TooltipContent>
                </Tooltip>
              )}
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
                        {config.outputs && Object.keys(config.outputs).length > 0 && (
                          <div>
                            <p className='mb-1 font-medium text-sm'>Output</p>
                            <div className='text-sm'>
                              {Object.entries(config.outputs).map(([key, value]) => (
                                <div key={key} className='mb-1'>
                                  <span className='text-muted-foreground'>{key}</span>{' '}
                                  {typeof value === 'object' &&
                                  value !== null &&
                                  'type' in value ? (
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
              {subBlockRows.length > 0 && (
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
              )}
            </div>
          </div>

          {/* Block Content - Only render if there are subblocks */}
          {subBlockRows.length > 0 && (
            <div
              ref={contentRef}
              className='cursor-pointer space-y-4 px-4 pt-3 pb-4'
              onMouseDown={(e) => {
                e.stopPropagation()
              }}
            >
              {subBlockRows.map((row, rowIndex) => (
                <div key={`row-${rowIndex}`} className='flex gap-4'>
                  {row.map((subBlock) => {
                    const stableKey = getSubBlockStableKey(subBlock, subBlockState)

                    return (
                      <div
                        key={stableKey}
                        className={cn(
                          'space-y-1',
                          subBlock.layout === 'half' ? 'flex-1' : 'w-full'
                        )}
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
                    )
                  })}
                </div>
              ))}
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
              {config.category !== 'triggers' && type !== 'starter' && !displayTriggerMode && (
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
  },
  (prevProps, nextProps) => {
    // Custom comparison function to prevent unnecessary re-renders
    // Only re-render if these specific props change
    // Return TRUE to skip re-render, FALSE to re-render
    const shouldSkipRender =
      prevProps.id === nextProps.id &&
      prevProps.data.type === nextProps.data.type &&
      prevProps.data.name === nextProps.data.name &&
      prevProps.data.isActive === nextProps.data.isActive &&
      prevProps.data.isPending === nextProps.data.isPending &&
      prevProps.data.isPreview === nextProps.data.isPreview &&
      prevProps.data.config === nextProps.data.config &&
      prevProps.data.subBlockValues === nextProps.data.subBlockValues &&
      prevProps.data.blockState === nextProps.data.blockState &&
      prevProps.selected === nextProps.selected &&
      prevProps.dragging === nextProps.dragging &&
      // Position changes should trigger re-render
      prevProps.xPos === nextProps.xPos &&
      prevProps.yPos === nextProps.yPos

    return shouldSkipRender
  }
)
