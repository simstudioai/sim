import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type NodeProps, useUpdateNodeInternals } from 'reactflow'
import { Code, Zap } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getEnv, isTruthy } from '@/lib/env'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import type { SubBlockConfig } from '@/blocks/types'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { usePanelEditorStore } from '@/stores/panel-new/editor/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useCurrentWorkflow } from '../../hooks'
import { BlockHandles, BlockHeader } from './components'
import { ActionBar } from './components/action-bar/action-bar'
import { ConnectionBlocks } from './components/connection-blocks/connection-blocks'
import { SubBlock } from '../panel-new/components/editor/components/sub-block/sub-block'
import {
  useBlockProperties,
  useBlockState,
  useChildWorkflow,
  useScheduleInfo,
  useWebhookInfo,
} from './hooks'
import type { WorkflowBlockProps } from './types'
import { shouldSkipBlockRender } from './utils'

/**
 * WorkflowBlock is the main component for rendering workflow blocks in the canvas
 * It handles block rendering, state management, and user interactions
 */
export const WorkflowBlock = memo(function WorkflowBlock({
  id,
  data,
}: NodeProps<WorkflowBlockProps>) {
  const { type, config, name, isPending } = data

  // State management
  const [isConnecting, setIsConnecting] = useState(false)

  // Get active workflow ID
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)

  // Refs
  const blockRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const updateNodeInternals = useUpdateNodeInternals()

  // Get current workflow state
  const currentWorkflow = useCurrentWorkflow()

  // User permissions
  const userPermissions = useUserPermissionsContext()

  // Collaborative workflow actions
  const { collaborativeUpdateBlockName, collaborativeSetSubblockValue } = useCollaborativeWorkflow()

  // Clear credential-dependent fields when credential changes
  const prevCredRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const currentActiveWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
    if (!currentActiveWorkflowId) return
    const current = useSubBlockStore.getState().workflowValues[currentActiveWorkflowId]?.[id]
    if (!current) return
    const cred = current.credential?.value as string | undefined
    if (prevCredRef.current !== cred) {
      prevCredRef.current = cred
      const keys = Object.keys(current)
      const dependentKeys = keys.filter((k) => k !== 'credential')
      dependentKeys.forEach((k) => collaborativeSetSubblockValue(id, k, ''))
    }
  }, [id, collaborativeSetSubblockValue])

  // Block state and execution status
  const { isEnabled, isActive, diffStatus, isDeletedBlock, fieldDiff } = useBlockState(
    id,
    currentWorkflow,
    data
  )

  // Block properties (handles, trigger mode)
  const { horizontalHandles, displayTriggerMode } = useBlockProperties(
    id,
    currentWorkflow.isDiffMode,
    data.isPreview ?? false,
    data.blockState,
    currentWorkflow.blocks
  )

  // Schedule information
  const {
    scheduleInfo,
    isLoading: isLoadingScheduleInfo,
    reactivateSchedule,
    disableSchedule,
  } = useScheduleInfo(id, type, activeWorkflowId ?? '')

  // Webhook information
  const { isWebhookConfigured, webhookProvider, webhookPath } = useWebhookInfo(id)

  // Child workflow information
  const { childWorkflowId, childActiveVersion, childIsDeployed, isLoadingChildVersion } =
    useChildWorkflow(id, type, data.isPreview ?? false, data.subBlockValues)

  // Get additional block properties from store
  const { storeBlockHeight, storeBlockLayout, storeBlockAdvancedMode } = useWorkflowStore(
    useCallback(
      (state) => {
        const block = state.blocks[id]
        return {
          storeBlockHeight: block?.height ?? 0,
          storeBlockLayout: block?.layout,
          storeBlockAdvancedMode: block?.advancedMode ?? false,
        }
      },
      [id]
    )
  )

  // Get block properties from currentWorkflow when in diff mode, otherwise from workflow store
  const blockHeight = currentWorkflow.isDiffMode
    ? (currentWorkflow.blocks[id]?.height ?? 0)
    : storeBlockHeight

  const blockWidth = currentWorkflow.isDiffMode
    ? (currentWorkflow.blocks[id]?.layout?.measuredWidth ?? 0)
    : (storeBlockLayout?.measuredWidth ?? 0)

  const blockAdvancedMode = currentWorkflow.isDiffMode
    ? (currentWorkflow.blocks[id]?.advancedMode ?? false)
    : storeBlockAdvancedMode

  // Local UI state for diff mode controls
  const [diffAdvancedMode, setDiffAdvancedMode] = useState<boolean>(blockAdvancedMode)
  const [diffTriggerMode, setDiffTriggerMode] = useState<boolean>(displayTriggerMode)

  useEffect(() => {
    if (currentWorkflow.isDiffMode) {
      setDiffAdvancedMode(blockAdvancedMode)
      setDiffTriggerMode(displayTriggerMode)
    }
  }, [currentWorkflow.isDiffMode, blockAdvancedMode, displayTriggerMode])

  const displayAdvancedMode = currentWorkflow.isDiffMode
    ? diffAdvancedMode
    : data.isPreview
      ? (data.blockState?.advancedMode ?? false)
      : blockAdvancedMode

  const finalDisplayTriggerMode = currentWorkflow.isDiffMode
    ? diffTriggerMode
    : displayTriggerMode

  // Workflow store actions
  const { collaborativeToggleBlockAdvancedMode, collaborativeToggleBlockTriggerMode } =
    useCollaborativeWorkflow()
  const updateBlockLayoutMetrics = useWorkflowStore((state) => state.updateBlockLayoutMetrics)

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

  const currentBlock = currentWorkflow.getBlockById(id)

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
      stateToUse = Object.entries(blockSubBlockValues).reduce(
        (acc, [key, value]) => {
          acc[key] = { value }
          return acc
        },
        {} as Record<string, any>
      )
    }

    const effectiveAdvanced = displayAdvancedMode
    const effectiveTrigger = finalDisplayTriggerMode

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
      // All blocks take full width
      if (currentRow.length > 0) {
        rows.push([...currentRow])
      }
      currentRow = [block]
      currentRowWidth = 1
    })

    if (currentRow.length > 0) {
      rows.push(currentRow)
    }

    // Return both rows and state for stable key generation
    return { rows, stateToUse }
  }, [
    config.subBlocks,
    config.category,
    config.triggers?.enabled,
    displayAdvancedMode,
    finalDisplayTriggerMode,
    data.isPreview,
    data.subBlockValues,
    currentWorkflow.isDiffMode,
    currentBlock,
    blockSubBlockValues,
  ])

  // Extract rows and state from the memoized value
  const subBlockRows = subBlockRowsData.rows
  const subBlockState = subBlockRowsData.stateToUse

  // Badge display conditions
  const shouldShowScheduleBadge =
    type === 'schedule' && !isLoadingScheduleInfo && scheduleInfo !== null
  const isStarterBlock = type === 'starter'
  const isWebhookTriggerBlock = type === 'webhook'
  const showWebhookIndicator = (isStarterBlock || isWebhookTriggerBlock) && isWebhookConfigured

  // Handler: Update block name
  const handleUpdateName = useCallback(
    (newName: string) => {
      collaborativeUpdateBlockName(id, newName)
    },
    [id, collaborativeUpdateBlockName]
  )

  // Handler: Select block for editing
  const setCurrentBlockId = usePanelEditorStore((s) => s.setCurrentBlockId)
  const handleSelectBlock = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation()
      setCurrentBlockId(id)
    },
    [id, setCurrentBlockId]
  )

  return (
    <div className='group relative'>
      <div
        ref={blockRef}
        className={cn(
          'relative cursor-default select-none rounded-[8px] bg-[#232323]',
          'transition-block-bg transition-ring',
          'w-[320px]',
          isActive && 'animate-pulse-ring ring-2 ring-blue-500',
          isPending && 'ring-2 ring-amber-500',
          diffStatus === 'new' && 'bg-green-50/50 ring-2 ring-green-500 dark:bg-green-900/10',
          diffStatus === 'edited' && 'bg-orange-50/50 ring-2 ring-orange-500 dark:bg-orange-900/10',
          isDeletedBlock && 'bg-red-50/50 ring-2 ring-red-500 dark:bg-red-900/10',
          'z-[20]'
        )}
        onClick={handleSelectBlock}
      >
        {/* Pending indicator */}
        {isPending && (
          <div className='-top-6 -translate-x-1/2 absolute left-1/2 z-10 transform rounded-t-md bg-amber-500 px-2 py-0.5 text-white text-xs'>
            Next Step
          </div>
        )}

        {/* Action Bar */}
        <ActionBar blockId={id} blockType={type} disabled={!userPermissions.canEdit} />

        {/* Connection Blocks */}
        {config.category !== 'triggers' && type !== 'starter' && !finalDisplayTriggerMode && (
          <ConnectionBlocks
            blockId={id}
            setIsConnecting={setIsConnecting}
            isDisabled={!userPermissions.canEdit}
            horizontalHandles={horizontalHandles}
          />
        )}

        {/* Connection Handles */}
        <BlockHandles
          blockId={id}
          blockType={type}
          blockCategory={config.category}
          horizontalHandles={horizontalHandles}
          displayTriggerMode={finalDisplayTriggerMode}
        />

        {/* Block Header */}
        <div className={cn(subBlockRows.length > 0 && 'border-b')}>
          <div className='flex items-center justify-between'>
            <BlockHeader
              blockId={id}
              config={config}
              name={name}
              isEnabled={isEnabled}
              isDiffMode={currentWorkflow.isDiffMode}
              canEdit={userPermissions.canEdit}
              isOfflineMode={userPermissions.isOfflineMode ?? false}
              shouldShowScheduleBadge={shouldShowScheduleBadge}
              scheduleInfo={scheduleInfo}
              showWebhookIndicator={showWebhookIndicator}
              webhookProvider={webhookProvider}
              webhookPath={webhookPath}
              childWorkflowId={childWorkflowId}
              childIsDeployed={childIsDeployed}
              childActiveVersion={childActiveVersion}
              isLoadingChildVersion={isLoadingChildVersion}
              onUpdateName={handleUpdateName}
              onReactivateSchedule={reactivateSchedule}
              onDisableSchedule={disableSchedule}
            />

            <div className='flex flex-shrink-0 items-center gap-2 pr-[8px]'>
              {/* Advanced Mode Toggle */}
              {config.subBlocks.some((block) => block.mode) && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
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
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>
                    {!userPermissions.canEdit && !currentWorkflow.isDiffMode
                      ? userPermissions.isOfflineMode
                        ? 'Connection lost - please refresh'
                        : 'Read-only mode'
                      : displayAdvancedMode
                        ? 'Switch to Basic Mode'
                        : 'Switch to Advanced Mode'}
                  </Tooltip.Content>
                </Tooltip.Root>
              )}

              {/* Trigger Mode Button */}
              {config.triggers?.enabled && config.category !== 'triggers' && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => {
                        if (currentWorkflow.isDiffMode) {
                          setDiffTriggerMode((prev) => !prev)
                        } else if (userPermissions.canEdit) {
                          collaborativeToggleBlockTriggerMode(id)
                        }
                      }}
                      className={cn(
                        'h-7 p-1 text-gray-500',
                        finalDisplayTriggerMode && 'text-[#22C55E]',
                        !userPermissions.canEdit &&
                          !currentWorkflow.isDiffMode &&
                          'cursor-not-allowed opacity-50'
                      )}
                      disabled={!userPermissions.canEdit && !currentWorkflow.isDiffMode}
                    >
                      <Zap className='h-5 w-5' />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>
                    {!userPermissions.canEdit && !currentWorkflow.isDiffMode
                      ? userPermissions.isOfflineMode
                        ? 'Connection lost - please refresh'
                        : 'Read-only mode'
                      : finalDisplayTriggerMode
                        ? 'Switch to Action Mode'
                        : 'Switch to Trigger Mode'}
                  </Tooltip.Content>
                </Tooltip.Root>
              )}
            </div>
          </div>
        </div>

        {/* Block Content - SubBlocks */}
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
                    <div key={stableKey} className='w-full space-y-1'>
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
                      />
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}, shouldSkipBlockRender)
