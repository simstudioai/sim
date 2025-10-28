import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { type NodeProps, useUpdateNodeInternals } from 'reactflow'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { type DiffStatus, hasDiffStatus } from '@/lib/workflows/diff/types'
import { TRIGGER_TYPES } from '@/lib/workflows/triggers'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useCurrentWorkflow } from '../../hooks'
import { BlockHandles, BlockHeader } from './components'
import { ActionBar } from './components/action-bar/action-bar'
import { ConnectionBlocks } from './components/connection-blocks/connection-blocks'
import { useSubBlockValue } from './components/sub-block/hooks/use-sub-block-value'
import { SubBlock } from './components/sub-block/sub-block'
import { useBlockProperties } from './hooks/use-block-properties'
import { useBlockResize } from './hooks/use-block-resize'
import { useChildDeployment } from './hooks/use-child-deployment'
import { useScheduleInfo } from './hooks/use-schedule-info'
import { useSubblockLayout } from './hooks/use-subblock-layout'
import type { WorkflowBlockProps } from './types'
import { getSubBlockStableKey } from './utils'

/**
 * WorkflowBlock is the main component for rendering workflow blocks in the canvas
 * It handles block rendering, state management, and user interactions
 */
export const WorkflowBlock = memo(
  function WorkflowBlock({ id, data }: NodeProps<WorkflowBlockProps>) {
    const { type, config, name, isActive: dataIsActive, isPending } = data

    // Get active workflow ID
    const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)

    // Refs
    const blockRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const updateNodeInternals = useUpdateNodeInternals()

    // State
    const [isConnecting, setIsConnecting] = useState(false)

    // Get current workflow state
    const currentWorkflow = useCurrentWorkflow()
    const currentBlock = currentWorkflow.getBlockById(id)

    // Get workflow ID from URL params
    const params = useParams()
    const currentWorkflowId = params.workflowId as string

    // Determine if block is enabled
    const isEnabled = data.isPreview
      ? (data.blockState?.enabled ?? true)
      : (currentBlock?.enabled ?? true)

    // Get diff status
    const diffStatus: DiffStatus =
      currentWorkflow.isDiffMode && currentBlock && hasDiffStatus(currentBlock)
        ? currentBlock.is_diff
        : undefined

    // Get diff-related data
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

    // Get block properties using custom hook
    const {
      horizontalHandles,
      blockHeight,
      blockWidth,
      displayIsWide,
      displayAdvancedMode,
      displayTriggerMode,
      setDiffIsWide,
      setDiffAdvancedMode,
      setDiffTriggerMode,
    } = useBlockProperties(
      id,
      currentWorkflow.isDiffMode,
      data.isPreview ?? false,
      data.blockState,
      currentWorkflow.blocks
    )

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

    // Execution state
    const isActiveBlock = useExecutionStore((state) => state.activeBlockIds.has(id))
    const isActive = dataIsActive || isActiveBlock

    // Block type checks
    const isStarterBlock = type === 'starter'
    const isWebhookTriggerBlock = type === 'webhook' || type === 'generic_webhook'

    // Get webhook status
    const blockWebhookStatus = useSubBlockStore(
      useCallback(
        (state) => {
          const blockValues = state.workflowValues[activeWorkflowId || '']?.[id]
          return !!(blockValues?.webhookProvider && blockValues?.webhookPath)
        },
        [activeWorkflowId, id]
      )
    )

    // Use schedule info hook
    const {
      scheduleInfo,
      isLoading: isLoadingScheduleInfo,
      reactivateSchedule,
      disableSchedule,
    } = useScheduleInfo(id, type, currentWorkflowId)

    // Get child workflow deployment info
    const isWorkflowSelector = type === 'workflow' || type === 'workflow_input'
    const [workflowIdFromStore] = useSubBlockValue<string>(id, 'workflowId')

    let childWorkflowId: string | undefined
    if (!data.isPreview) {
      const val = workflowIdFromStore
      if (typeof val === 'string' && val.trim().length > 0) {
        childWorkflowId = val
      }
    } else if (data.isPreview && data.subBlockValues?.workflowId?.value) {
      const val = data.subBlockValues.workflowId.value
      if (typeof val === 'string' && val.trim().length > 0) childWorkflowId = val
    }

    const {
      activeVersion: childActiveVersion,
      isDeployed: childIsDeployed,
      isLoading: isLoadingChildVersion,
    } = useChildDeployment(childWorkflowId)

    // Subscribe to block's subblock values
    const blockSubBlockValues = useSubBlockStore(
      useCallback(
        (state) => {
          if (!activeWorkflowId) return {}
          return state.workflowValues[activeWorkflowId]?.[id] || {}
        },
        [activeWorkflowId, id]
      )
    )

    // Get subblock layout using custom hook
    const { rows: subBlockRows, stateToUse: subBlockState } = useSubblockLayout(
      config,
      id,
      displayAdvancedMode,
      displayTriggerMode,
      data.isPreview ?? false,
      currentWorkflow.isDiffMode,
      data.subBlockValues,
      currentBlock,
      activeWorkflowId,
      blockSubBlockValues
    )

    // Handle block resize
    useBlockResize(id, contentRef as React.RefObject<HTMLDivElement>, blockHeight, blockWidth)

    // Update node internals when handles change
    useEffect(() => {
      updateNodeInternals(id)
    }, [id, horizontalHandles, updateNodeInternals])

    // User permissions
    const userPermissions = useUserPermissionsContext()

    // Badge conditions
    const shouldShowScheduleBadge =
      type === 'schedule' && !isLoadingScheduleInfo && scheduleInfo !== null
    const showWebhookIndicator = (isStarterBlock || isWebhookTriggerBlock) && blockWebhookStatus

    // Get webhook info from store
    const webhookProvider = blockSubBlockValues?.webhookProvider?.value as string | undefined
    const webhookPath = blockSubBlockValues?.webhookPath as string | undefined

    // Handler functions
    const handleToggleAdvancedMode = useCallback(() => {
      if (currentWorkflow.isDiffMode) {
        setDiffAdvancedMode((prev) => !prev)
      } else if (userPermissions.canEdit) {
        collaborativeToggleBlockAdvancedMode(id)
      }
    }, [
      currentWorkflow.isDiffMode,
      userPermissions.canEdit,
      id,
      collaborativeToggleBlockAdvancedMode,
      setDiffAdvancedMode,
    ])

    const handleToggleTriggerMode = useCallback(() => {
      if (currentWorkflow.isDiffMode) {
        setDiffTriggerMode((prev) => !prev)
      } else if (userPermissions.canEdit) {
        collaborativeToggleBlockTriggerMode(id)
      }
    }, [
      currentWorkflow.isDiffMode,
      userPermissions.canEdit,
      id,
      collaborativeToggleBlockTriggerMode,
      setDiffTriggerMode,
    ])

    const handleToggleWide = useCallback(() => {
      if (currentWorkflow.isDiffMode) {
        setDiffIsWide((prev) => !prev)
      } else if (userPermissions.canEdit) {
        collaborativeToggleBlockWide(id)
      }
    }, [
      currentWorkflow.isDiffMode,
      userPermissions.canEdit,
      id,
      collaborativeToggleBlockWide,
      setDiffIsWide,
    ])

    const handleUpdateName = useCallback(
      (newName: string) => {
        collaborativeUpdateBlockName(id, newName)
      },
      [id, collaborativeUpdateBlockName]
    )

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
            diffStatus === 'new' && 'bg-green-50/50 ring-2 ring-green-500 dark:bg-green-900/10',
            diffStatus === 'edited' &&
              'bg-orange-50/50 ring-2 ring-orange-500 dark:bg-orange-900/10',
            isDeletedBlock && 'bg-red-50/50 ring-2 ring-red-500 dark:bg-red-900/10',
            'z-[20]'
          )}
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
          {config.category !== 'triggers' && type !== 'starter' && !displayTriggerMode && (
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
            displayTriggerMode={displayTriggerMode}
          />

          {/* Block Header */}
          <BlockHeader
            blockId={id}
            config={config}
            name={name}
            isEnabled={isEnabled}
            displayIsWide={displayIsWide}
            displayAdvancedMode={displayAdvancedMode}
            displayTriggerMode={displayTriggerMode}
            isDiffMode={currentWorkflow.isDiffMode}
            hasSubBlocks={subBlockRows.length > 0}
            canEdit={userPermissions.canEdit}
            isOfflineMode={userPermissions.isOfflineMode ?? false}
            shouldShowScheduleBadge={shouldShowScheduleBadge}
            scheduleInfo={scheduleInfo}
            showWebhookIndicator={showWebhookIndicator}
            webhookProvider={webhookProvider}
            webhookPath={webhookPath}
            childWorkflowId={isWorkflowSelector ? childWorkflowId : undefined}
            childIsDeployed={childIsDeployed}
            childActiveVersion={childActiveVersion}
            isLoadingChildVersion={isLoadingChildVersion}
            onUpdateName={handleUpdateName}
            onReactivateSchedule={reactivateSchedule}
            onDisableSchedule={disableSchedule}
            onToggleAdvancedMode={handleToggleAdvancedMode}
            onToggleTriggerMode={handleToggleTriggerMode}
            onToggleWide={handleToggleWide}
          />

          {/* Block Content */}
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
                    const stableKey = getSubBlockStableKey(id, subBlock, subBlockState)

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
        </Card>
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Custom comparison function to prevent unnecessary re-renders
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
      prevProps.xPos === nextProps.xPos &&
      prevProps.yPos === nextProps.yPos

    return shouldSkipRender
  }
)
