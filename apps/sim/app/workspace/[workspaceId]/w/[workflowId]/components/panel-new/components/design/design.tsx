'use client'

import { useCallback } from 'react'
import { BookOpen, Settings } from 'lucide-react'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { SubBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/design/components/sub-block/sub-block'
import { getSubBlockStableKey } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/utils'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { getBlock } from '@/blocks/registry'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { usePanelDesignStore } from '@/stores/panel-new/design/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useDesignBlockProperties, useDesignSubblockLayout } from './hooks'

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
 * Design panel component.
 * Provides design configuration and customization options for the workflow.
 *
 * @returns Design panel content
 */
export function Design() {
  const { currentBlockId } = usePanelDesignStore()
  const currentWorkflow = useCurrentWorkflow()
  const currentBlock = currentBlockId ? currentWorkflow.getBlockById(currentBlockId) : null
  const blockConfig = currentBlock ? getBlock(currentBlock.type) : null
  const title = currentBlock?.name || 'Design'

  // Get user permissions
  const userPermissions = useUserPermissionsContext()

  // Get active workflow ID
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  // Get block properties (advanced/trigger modes)
  const { advancedMode, triggerMode } = useDesignBlockProperties(currentBlockId)

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
  const { rows: subBlockRows, stateToUse: subBlockState } = useDesignSubblockLayout(
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
      {/* Header (mirrors Copilot header styles) */}
      <div className='flex flex-shrink-0 items-center justify-between rounded-[4px] bg-[#2A2A2A] px-[12px] py-[8px] dark:bg-[#2A2A2A]'>
        <div className='flex items-center gap-[8px]'>
          {blockConfig && (
            <div
              className='flex h-[18px] w-[18px] items-center justify-center rounded-[4px]'
              style={{ backgroundColor: blockConfig.bgColor }}
            >
              <IconComponent icon={blockConfig.icon} className='h-[12px] w-[12px] text-[#FFFFFF]' />
            </div>
          )}
          <h2 className='font-medium text-[#FFFFFF] text-[14px] dark:text-[#FFFFFF]'>{title}</h2>
        </div>
        <div className='flex items-center gap-[8px]'>
          {/* Mode toggles */}
          {currentBlockId && hasAdvancedMode && (
            <Button
              variant='ghost'
              className={cn('p-0', advancedMode && 'text-blue-400')}
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
      <div className='flex-1 overflow-y-auto overflow-x-hidden'>
        {!currentBlockId ? (
          <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
            Select a block to edit its configuration
          </div>
        ) : subBlockRows.length === 0 ? (
          <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
            No configuration available for this block
          </div>
        ) : (
          <div className=''>
            {subBlockRows.map((row, rowIndex) => (
              <div key={`row-${rowIndex}`} className='flex'>
                {row.map((subBlock) => {
                  const stableKey = getSubBlockStableKey(
                    currentBlockId || '',
                    subBlock,
                    subBlockState
                  )

                  return (
                    <div
                      key={stableKey}
                      className={cn(subBlock.layout === 'half' ? 'flex-1' : 'w-full')}
                    >
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
}
