'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, Check, ChevronUp, Pencil, Settings } from 'lucide-react'
import { Button, Tooltip } from '@/components/emcn'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  ConnectionBlocks,
  SubBlock,
  SubflowEditor,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components'
import {
  useBlockConnections,
  useConnectionsResize,
  useEditorBlockProperties,
  useEditorSubblockLayout,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/hooks'
import { LoopTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config'
import { ParallelTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config'
import { getSubBlockStableKey } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/utils'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { getBlock } from '@/blocks/registry'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { usePanelEditorStore } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

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
  const {
    currentBlockId,
    connectionsHeight,
    toggleConnectionsCollapsed,
    shouldFocusRename,
    setShouldFocusRename,
  } = usePanelEditorStore()
  const currentWorkflow = useCurrentWorkflow()
  const currentBlock = currentBlockId ? currentWorkflow.getBlockById(currentBlockId) : null
  const blockConfig = currentBlock ? getBlock(currentBlock.type) : null
  const title = currentBlock?.name || 'Editor'

  // Check if selected block is a subflow (loop or parallel)
  const isSubflow =
    currentBlock && (currentBlock.type === 'loop' || currentBlock.type === 'parallel')

  // Get subflow display properties from configs
  const subflowConfig = isSubflow ? (currentBlock.type === 'loop' ? LoopTool : ParallelTool) : null

  // Refs for resize functionality
  const subBlocksRef = useRef<HTMLDivElement>(null)

  // Get user permissions
  const userPermissions = useUserPermissionsContext()

  // Get active workflow ID
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  // Get block properties (advanced/trigger modes)
  const { advancedMode, triggerMode } = useEditorBlockProperties(
    currentBlockId,
    currentWorkflow.isSnapshotView
  )

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
    blockSubBlockValues,
    currentWorkflow.isSnapshotView
  )

  // Get block connections
  const { incomingConnections, hasIncomingConnections } = useBlockConnections(currentBlockId || '')

  // Connections resize hook
  const { handleMouseDown: handleConnectionsResizeMouseDown, isResizing } = useConnectionsResize({
    subBlocksRef,
  })

  // Collaborative actions
  const { collaborativeToggleBlockAdvancedMode, collaborativeUpdateBlockName } =
    useCollaborativeWorkflow()

  // Rename state
  const [isRenaming, setIsRenaming] = useState(false)
  const [editedName, setEditedName] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Mode toggle handlers
  const handleToggleAdvancedMode = useCallback(() => {
    if (currentBlockId && userPermissions.canEdit) {
      collaborativeToggleBlockAdvancedMode(currentBlockId)
    }
  }, [currentBlockId, userPermissions.canEdit, collaborativeToggleBlockAdvancedMode])

  /**
   * Handles starting the rename process.
   */
  const handleStartRename = useCallback(() => {
    if (!userPermissions.canEdit || !currentBlock) return
    setEditedName(currentBlock.name || '')
    setIsRenaming(true)
  }, [userPermissions.canEdit, currentBlock])

  /**
   * Handles saving the renamed block.
   */
  const handleSaveRename = useCallback(() => {
    if (!currentBlockId || !isRenaming) return

    const trimmedName = editedName.trim()
    if (trimmedName && trimmedName !== currentBlock?.name) {
      const result = collaborativeUpdateBlockName(currentBlockId, trimmedName)
      if (!result.success) {
        // Keep rename mode open on error so user can correct the name
        return
      }
    }
    setIsRenaming(false)
  }, [currentBlockId, isRenaming, editedName, currentBlock?.name, collaborativeUpdateBlockName])

  /**
   * Handles canceling the rename process.
   */
  const handleCancelRename = useCallback(() => {
    setIsRenaming(false)
    setEditedName('')
  }, [])

  // Focus input when entering rename mode
  useEffect(() => {
    if (isRenaming && nameInputRef.current) {
      nameInputRef.current.select()
    }
  }, [isRenaming])

  // Trigger rename mode when signaled from context menu
  useEffect(() => {
    if (shouldFocusRename && currentBlock && !isSubflow) {
      handleStartRename()
      setShouldFocusRename(false)
    }
  }, [shouldFocusRename, currentBlock, isSubflow, handleStartRename, setShouldFocusRename])

  /**
   * Handles opening documentation link in a new secure tab.
   */
  const handleOpenDocs = () => {
    const docsLink = isSubflow ? subflowConfig?.docsLink : blockConfig?.docsLink
    if (docsLink) {
      window.open(docsLink, '_blank', 'noopener,noreferrer')
    }
  }

  // Check if block has advanced mode or trigger mode available
  const hasAdvancedMode = blockConfig?.subBlocks?.some((sb) => sb.mode === 'advanced')

  // Determine if connections are at minimum height (collapsed state)
  const isConnectionsAtMinHeight = connectionsHeight <= 35

  return (
    <div className='flex h-full flex-col'>
      {/* Header */}
      <div className='mx-[-1px] flex flex-shrink-0 items-center justify-between rounded-[4px] border border-[var(--border)] bg-[var(--surface-4)] px-[12px] py-[6px]'>
        <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
          {(blockConfig || isSubflow) && currentBlock?.type !== 'note' && (
            <div
              className='flex h-[18px] w-[18px] items-center justify-center rounded-[4px]'
              style={{ background: isSubflow ? subflowConfig?.bgColor : blockConfig?.bgColor }}
            >
              <IconComponent
                icon={isSubflow ? subflowConfig?.icon : blockConfig?.icon}
                className='h-[12px] w-[12px] text-[var(--white)]'
              />
            </div>
          )}
          {isRenaming ? (
            <input
              ref={nameInputRef}
              type='text'
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onBlur={handleSaveRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSaveRename()
                } else if (e.key === 'Escape') {
                  handleCancelRename()
                }
              }}
              className='min-w-0 flex-1 truncate bg-transparent pr-[8px] font-medium text-[14px] text-[var(--text-primary)] outline-none'
            />
          ) : (
            <h2
              className='min-w-0 flex-1 cursor-pointer select-none truncate pr-[8px] font-medium text-[14px] text-[var(--text-primary)]'
              title={title}
              onDoubleClick={handleStartRename}
              onMouseDown={(e) => {
                if (e.detail === 2) {
                  e.preventDefault()
                }
              }}
            >
              {title}
            </h2>
          )}
        </div>
        <div className='flex shrink-0 items-center gap-[8px]'>
          {/* Rename button */}
          {currentBlock && !isSubflow && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  className='p-0'
                  onClick={isRenaming ? handleSaveRename : handleStartRename}
                  disabled={!userPermissions.canEdit}
                  aria-label={isRenaming ? 'Save name' : 'Rename block'}
                >
                  {isRenaming ? (
                    <Check className='h-[14px] w-[14px]' />
                  ) : (
                    <Pencil className='h-[14px] w-[14px]' />
                  )}
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>
                <p>{isRenaming ? 'Save name' : 'Rename block'}</p>
              </Tooltip.Content>
            </Tooltip.Root>
          )}
          {/* Focus on block button */}
          {/* {currentBlock && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  className='p-0'
                  onClick={handleFocusOnBlock}
                  aria-label='Focus on block'
                >
                  <Crosshair className='h-[14px] w-[14px]' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>
                <p>Focus on block</p>
              </Tooltip.Content>
            </Tooltip.Root>
          )} */}
          {/* Mode toggles - Only show for regular blocks, not subflows */}
          {currentBlock && !isSubflow && hasAdvancedMode && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  className='p-0'
                  onClick={handleToggleAdvancedMode}
                  disabled={!userPermissions.canEdit}
                  aria-label='Toggle advanced mode'
                >
                  <Settings className='h-[14px] w-[14px]' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>
                <p>Advanced mode</p>
              </Tooltip.Content>
            </Tooltip.Root>
          )}
          {currentBlock && (isSubflow ? subflowConfig?.docsLink : blockConfig?.docsLink) && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  className='p-0'
                  onClick={handleOpenDocs}
                  aria-label='Open documentation'
                >
                  <BookOpen className='h-[14px] w-[14px]' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>
                <p>Open docs</p>
              </Tooltip.Content>
            </Tooltip.Root>
          )}
        </div>
      </div>

      {!currentBlockId || !currentBlock ? (
        <div className='flex flex-1 items-center justify-center text-[#8D8D8D] text-[13px]'>
          Select a block to edit
        </div>
      ) : isSubflow ? (
        <SubflowEditor
          currentBlock={currentBlock}
          currentBlockId={currentBlockId}
          subBlocksRef={subBlocksRef}
          connectionsHeight={connectionsHeight}
          isResizing={isResizing}
          hasIncomingConnections={hasIncomingConnections}
          incomingConnections={incomingConnections}
          handleConnectionsResizeMouseDown={handleConnectionsResizeMouseDown}
          toggleConnectionsCollapsed={toggleConnectionsCollapsed}
          userCanEdit={userPermissions.canEdit}
          isConnectionsAtMinHeight={isConnectionsAtMinHeight}
        />
      ) : (
        <div className='flex flex-1 flex-col overflow-hidden pt-[0px]'>
          {/* Subblocks Section */}
          <div
            ref={subBlocksRef}
            className='subblocks-section flex flex-1 flex-col overflow-hidden'
          >
            <div className='flex-1 overflow-y-auto overflow-x-hidden px-[8px] pt-[8px] pb-[8px]'>
              {subBlocks.length === 0 ? (
                <div className='flex h-full items-center justify-center text-center text-[#8D8D8D] text-[13px]'>
                  This block has no subblocks
                </div>
              ) : (
                <div className='flex flex-col'>
                  {subBlocks.map((subBlock, index) => {
                    const stableKey = getSubBlockStableKey(
                      currentBlockId || '',
                      subBlock,
                      subBlockState
                    )

                    return (
                      <div key={stableKey} className='subblock-row'>
                        <SubBlock
                          blockId={currentBlockId}
                          config={subBlock}
                          isPreview={false}
                          subBlockValues={subBlockState}
                          disabled={!userPermissions.canEdit}
                          fieldDiffStatus={undefined}
                          allowExpandInPreview={false}
                        />
                        {index < subBlocks.length - 1 && (
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
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Connections Section - Only show when there are connections */}
          {hasIncomingConnections && (
            <div
              className={
                'connections-section flex flex-shrink-0 flex-col overflow-hidden border-[var(--border)] border-t' +
                (!isResizing ? ' transition-[height] duration-100 ease-out' : '')
              }
              style={{ height: `${connectionsHeight}px` }}
            >
              {/* Resize Handle */}
              <div className='relative'>
                <div
                  className='absolute top-[-4px] right-0 left-0 z-30 h-[8px] cursor-ns-resize'
                  onMouseDown={handleConnectionsResizeMouseDown}
                />
              </div>

              {/* Connections Header with Chevron */}
              <div
                className='flex flex-shrink-0 cursor-pointer items-center gap-[8px] px-[10px] pt-[5px] pb-[5px]'
                onClick={toggleConnectionsCollapsed}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleConnectionsCollapsed()
                  }
                }}
                role='button'
                tabIndex={0}
                aria-label={
                  isConnectionsAtMinHeight ? 'Expand connections' : 'Collapse connections'
                }
              >
                <ChevronUp
                  className={
                    'h-[14px] w-[14px] transition-transform' +
                    (!isConnectionsAtMinHeight ? ' rotate-180' : '')
                  }
                />
                <div className='font-medium text-[13px] text-[var(--text-primary)]'>
                  Connections
                </div>
              </div>

              {/* Connections Content - Always visible */}
              <div className='flex-1 overflow-y-auto overflow-x-hidden px-[6px] pb-[8px]'>
                <ConnectionBlocks
                  connections={incomingConnections}
                  currentBlockId={currentBlock.id}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
