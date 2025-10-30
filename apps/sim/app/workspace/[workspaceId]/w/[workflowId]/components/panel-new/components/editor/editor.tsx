'use client'

import { useCallback } from 'react'
import { BookOpen, Settings } from 'lucide-react'
import { Button } from '@/components/emcn'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { SubBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/sub-block'
import { getSubBlockStableKey } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/utils'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { getBlock } from '@/blocks/registry'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { usePanelEditorStore } from '@/stores/panel-new/editor/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useEditorBlockProperties, useEditorSubblockLayout } from './hooks'

/**
 * Icon component for rendering block icons.
 *
 * @param icon - The icon component to render
 * @param className - Optional CSS classes
 * @returns Rendered icon or null if no icon provided
 */
const IconComponent = ({ icon: Icon, className }: { icon: any; className?: string }) => {
  if (!Icon) return null
  return <Icon className={className} />
}

/**
 * Editor panel component.
 * Provides editor configuration and customization options for the workflow.
 *
 * @returns Editor panel content
 */
export function Editor() {
  const { currentBlockId } = usePanelEditorStore()
  const currentWorkflow = useCurrentWorkflow()
  const currentBlock = currentBlockId ? currentWorkflow.getBlockById(currentBlockId) : null
  const blockConfig = currentBlock ? getBlock(currentBlock.type) : null
  const title = currentBlock?.name || 'Editor'

  // Get user permissions
  const userPermissions = useUserPermissionsContext()

  // Get active workflow ID
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  // Get block properties (advanced/trigger modes)
  const { advancedMode, triggerMode } = useEditorBlockProperties(currentBlockId)

  // Subscribe to block's subblock values
  const blockSubBlockValues = useSubBlockStore(
    useCallback(
      (state) => {
        if (!activeWorkflowId || !currentBlockId) return {}
        return state.workflowValues[activeWorkflowId]?.[currentBlockId] || {}
      },
      [activeWorkflowId, currentBlockId]
    )
  )

  // Get subblock layout using custom hook
  const { subBlocks, stateToUse: subBlockState } = useEditorSubblockLayout(
    blockConfig || ({} as any),
    currentBlockId || '',
    advancedMode,
    triggerMode,
    activeWorkflowId,
    blockSubBlockValues
  )

  // Collaborative actions
  const { collaborativeToggleBlockAdvancedMode } = useCollaborativeWorkflow()

  // Mode toggle handlers
  const handleToggleAdvancedMode = useCallback(() => {
    if (currentBlockId && userPermissions.canEdit) {
      collaborativeToggleBlockAdvancedMode(currentBlockId)
    }
  }, [currentBlockId, userPermissions.canEdit, collaborativeToggleBlockAdvancedMode])

  // Check if block has advanced mode or trigger mode available
  const hasAdvancedMode = blockConfig?.subBlocks?.some((sb) => sb.mode === 'advanced')

  return (
    <div className='flex h-full flex-col'>
      {/* Header */}
      <div className='flex flex-shrink-0 items-center justify-between rounded-[4px] bg-[#2A2A2A] px-[12px] py-[8px] dark:bg-[#2A2A2A]'>
        <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
          {blockConfig && (
            <div
              className='flex h-[18px] w-[18px] items-center justify-center rounded-[4px]'
              style={{ backgroundColor: blockConfig.bgColor }}
            >
              <IconComponent icon={blockConfig.icon} className='h-[12px] w-[12px] text-[#FFFFFF]' />
            </div>
          )}
          <h2
            className='min-w-0 flex-1 truncate font-medium text-[#FFFFFF] text-[14px] dark:text-[#FFFFFF]'
            title={title}
          >
            {title}
          </h2>
        </div>
        <div className='flex shrink-0 items-center gap-[8px]'>
          {/* Mode toggles */}
          {currentBlockId && hasAdvancedMode && (
            <Button
              variant='ghost'
              className='p-0'
              onClick={handleToggleAdvancedMode}
              disabled={!userPermissions.canEdit}
              aria-label='Toggle advanced mode'
            >
              <Settings className='h-[14px] w-[14px]' />
            </Button>
          )}
          <Button variant='ghost' className='p-0' aria-label='Open documentation'>
            <BookOpen className='h-[14px] w-[14px]' />
          </Button>
        </div>
      </div>

      {/* Content area - Subblocks */}
      <div className='flex-1 overflow-y-auto overflow-x-hidden px-[8px] py-[8px]'>
        {!currentBlockId ? (
          <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
            Select a block to edit its configuration
          </div>
        ) : subBlocks.length === 0 ? (
          <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
            No configuration available for this block
          </div>
        ) : (
          <div className='flex flex-col'>
            {subBlocks.map((subBlock, index) => {
              const stableKey = getSubBlockStableKey(currentBlockId || '', subBlock, subBlockState)

              return (
                <div key={stableKey}>
                  <SubBlock
                    blockId={currentBlockId}
                    config={subBlock}
                    isConnecting={false}
                    isPreview={false}
                    subBlockValues={undefined}
                    disabled={!userPermissions.canEdit}
                    fieldDiffStatus={undefined}
                    allowExpandInPreview={false}
                  />
                  {index < subBlocks.length - 1 && (
                    <div className='px-[2px] pt-[16px] pb-[13px]'>
                      <div
                        className='h-[1.25px]'
                        style={{
                          backgroundImage:
                            'repeating-linear-gradient(to right, #2C2C2C 0px, #2C2C2C 6px, transparent 6px, transparent 12px)',
                        }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
