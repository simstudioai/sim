'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isEqual } from 'lodash'
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Lock,
  Pencil,
  Unlock,
} from 'lucide-react'
import { useParams } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { Button, Tooltip } from '@/components/emcn'
import {
  buildCanonicalIndex,
  evaluateSubBlockCondition,
  hasAdvancedValues,
  isCanonicalPair,
  resolveCanonicalMode,
} from '@/lib/workflows/subblocks/visibility'
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
import { PreviewWorkflow } from '@/app/workspace/[workspaceId]/w/components/preview'
import { getBlock } from '@/blocks/registry'
import type { SubBlockType } from '@/blocks/types'
import { useWorkflowState } from '@/hooks/queries/workflows'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { usePanelEditorStore } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/** Stable empty object to avoid creating new references */
const EMPTY_SUBBLOCK_VALUES = {} as Record<string, any>

/** Shared style for dashed divider lines */
const DASHED_DIVIDER_STYLE = {
  backgroundImage:
    'repeating-linear-gradient(to right, var(--border) 0px, var(--border) 6px, transparent 6px, transparent 12px)',
} as const

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
  const { currentBlockId, connectionsHeight, toggleConnectionsCollapsed, registerRenameCallback } =
    usePanelEditorStore(
      useShallow((state) => ({
        currentBlockId: state.currentBlockId,
        connectionsHeight: state.connectionsHeight,
        toggleConnectionsCollapsed: state.toggleConnectionsCollapsed,
        registerRenameCallback: state.registerRenameCallback,
      }))
    )
  const currentWorkflow = useCurrentWorkflow()
  const currentBlock = currentBlockId ? currentWorkflow.getBlockById(currentBlockId) : null
  const blockConfig = currentBlock ? getBlock(currentBlock.type) : null
  const title = currentBlock?.name || 'Editor'

  const isSubflow =
    currentBlock && (currentBlock.type === 'loop' || currentBlock.type === 'parallel')

  const subflowConfig = isSubflow ? (currentBlock.type === 'loop' ? LoopTool : ParallelTool) : null

  const isWorkflowBlock =
    currentBlock && (currentBlock.type === 'workflow' || currentBlock.type === 'workflow_input')

  const params = useParams()
  const workspaceId = params.workspaceId as string

  const subBlocksRef = useRef<HTMLDivElement>(null)

  const userPermissions = useUserPermissionsContext()

  // Check if block is locked (or inside a locked container) and compute edit permission
  // Locked blocks cannot be edited by anyone (admins can only lock/unlock)
  const blocks = useWorkflowStore((state) => state.blocks)
  const parentId = currentBlock?.data?.parentId as string | undefined
  const isParentLocked = parentId ? (blocks[parentId]?.locked ?? false) : false
  const isLocked = (currentBlock?.locked ?? false) || isParentLocked
  const canEditBlock = userPermissions.canEdit && !isLocked

  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  const { advancedMode, triggerMode } = useEditorBlockProperties(
    currentBlockId,
    currentWorkflow.isSnapshotView
  )

  const blockSubBlockValues = useStoreWithEqualityFn(
    useSubBlockStore,
    useCallback(
      (state) => {
        if (!activeWorkflowId || !currentBlockId) return EMPTY_SUBBLOCK_VALUES
        return state.workflowValues[activeWorkflowId]?.[currentBlockId] ?? EMPTY_SUBBLOCK_VALUES
      },
      [activeWorkflowId, currentBlockId]
    ),
    isEqual
  )

  const subBlocksForCanonical = useMemo(() => {
    const subBlocks = blockConfig?.subBlocks || []
    if (!triggerMode) return subBlocks
    return subBlocks.filter(
      (subBlock) =>
        subBlock.mode === 'trigger' || subBlock.type === ('trigger-config' as SubBlockType)
    )
  }, [blockConfig?.subBlocks, triggerMode])

  const canonicalIndex = useMemo(
    () => buildCanonicalIndex(subBlocksForCanonical),
    [subBlocksForCanonical]
  )
  const canonicalModeOverrides = currentBlock?.data?.canonicalModes
  const advancedValuesPresent = useMemo(
    () => hasAdvancedValues(subBlocksForCanonical, blockSubBlockValues, canonicalIndex),
    [subBlocksForCanonical, blockSubBlockValues, canonicalIndex]
  )
  const displayAdvancedOptions = canEditBlock ? advancedMode : advancedMode || advancedValuesPresent

  const hasAdvancedOnlyFields = useMemo(() => {
    for (const subBlock of subBlocksForCanonical) {
      if (subBlock.mode !== 'advanced') continue
      if (canonicalIndex.canonicalIdBySubBlockId[subBlock.id]) continue

      if (
        subBlock.condition &&
        !evaluateSubBlockCondition(subBlock.condition, blockSubBlockValues)
      ) {
        continue
      }

      return true
    }
    return false
  }, [subBlocksForCanonical, canonicalIndex.canonicalIdBySubBlockId, blockSubBlockValues])

  const { subBlocks, stateToUse: subBlockState } = useEditorSubblockLayout(
    blockConfig || ({} as any),
    currentBlockId || '',
    displayAdvancedOptions,
    triggerMode,
    activeWorkflowId,
    blockSubBlockValues,
    currentWorkflow.isSnapshotView
  )

  /**
   * Partitions subBlocks into regular fields and standalone advanced-only fields.
   * Standalone advanced fields have mode 'advanced' and are not part of a canonical swap pair.
   */
  const { regularSubBlocks, advancedOnlySubBlocks } = useMemo(() => {
    const regular: typeof subBlocks = []
    const advancedOnly: typeof subBlocks = []

    for (const subBlock of subBlocks) {
      const isStandaloneAdvanced =
        subBlock.mode === 'advanced' && !canonicalIndex.canonicalIdBySubBlockId[subBlock.id]

      if (isStandaloneAdvanced) {
        advancedOnly.push(subBlock)
      } else {
        regular.push(subBlock)
      }
    }

    return { regularSubBlocks: regular, advancedOnlySubBlocks: advancedOnly }
  }, [subBlocks, canonicalIndex.canonicalIdBySubBlockId])

  const { incomingConnections, hasIncomingConnections } = useBlockConnections(currentBlockId || '')

  const { handleMouseDown: handleConnectionsResizeMouseDown, isResizing } = useConnectionsResize({
    subBlocksRef,
  })

  const {
    collaborativeSetBlockCanonicalMode,
    collaborativeUpdateBlockName,
    collaborativeToggleBlockAdvancedMode,
    collaborativeBatchToggleLocked,
  } = useCollaborativeWorkflow()

  const handleToggleAdvancedMode = useCallback(() => {
    if (!currentBlockId || !canEditBlock) return
    collaborativeToggleBlockAdvancedMode(currentBlockId)
  }, [currentBlockId, canEditBlock, collaborativeToggleBlockAdvancedMode])

  const [isRenaming, setIsRenaming] = useState(false)
  const [editedName, setEditedName] = useState('')
  const renamingBlockIdRef = useRef<string | null>(null)

  /**
   * Ref callback that auto-selects the input text when mounted.
   */
  const nameInputRefCallback = useCallback((element: HTMLInputElement | null) => {
    if (element) {
      element.select()
    }
  }, [])

  /**
   * Starts the rename process for the current block.
   * Reads from stores directly to avoid stale closures when called via registered callback.
   * Captures the block ID in a ref to ensure the correct block is renamed even if selection changes.
   */
  const handleStartRename = useCallback(() => {
    const blockId = usePanelEditorStore.getState().currentBlockId
    if (!blockId) return

    const blocks = useWorkflowStore.getState().blocks
    const block = blocks[blockId]
    if (!block) return

    const parentId = block.data?.parentId as string | undefined
    const isParentLocked = parentId ? (blocks[parentId]?.locked ?? false) : false
    const isLocked = (block.locked ?? false) || isParentLocked
    if (!userPermissions.canEdit || isLocked) return

    renamingBlockIdRef.current = blockId
    setEditedName(block.name || '')
    setIsRenaming(true)
  }, [userPermissions.canEdit])

  /**
   * Saves the renamed block using the captured block ID from when rename started.
   */
  const handleSaveRename = useCallback(() => {
    const blockIdToRename = renamingBlockIdRef.current
    if (!blockIdToRename || !isRenaming) return

    const blocks = useWorkflowStore.getState().blocks
    const blockToRename = blocks[blockIdToRename]

    const trimmedName = editedName.trim()
    if (trimmedName && blockToRename && trimmedName !== blockToRename.name) {
      const result = collaborativeUpdateBlockName(blockIdToRename, trimmedName)
      if (!result.success) {
        return
      }
    }
    renamingBlockIdRef.current = null
    setIsRenaming(false)
  }, [isRenaming, editedName, collaborativeUpdateBlockName])

  /**
   * Handles canceling the rename process.
   */
  const handleCancelRename = useCallback(() => {
    renamingBlockIdRef.current = null
    setIsRenaming(false)
    setEditedName('')
  }, [])

  useEffect(() => {
    registerRenameCallback(handleStartRename)
    return () => registerRenameCallback(null)
  }, [registerRenameCallback, handleStartRename])

  /**
   * Handles opening documentation link in a new secure tab.
   */
  const handleOpenDocs = useCallback(() => {
    const docsLink = isSubflow ? subflowConfig?.docsLink : blockConfig?.docsLink
    window.open(docsLink || 'https://docs.sim.ai/quick-reference', '_blank', 'noopener,noreferrer')
  }, [isSubflow, subflowConfig?.docsLink, blockConfig?.docsLink])

  const childWorkflowId = isWorkflowBlock ? blockSubBlockValues?.workflowId : null

  const { data: childWorkflowState, isLoading: isLoadingChildWorkflow } =
    useWorkflowState(childWorkflowId)

  /**
   * Handles opening the child workflow in a new tab.
   */
  const handleOpenChildWorkflow = useCallback(() => {
    if (childWorkflowId && workspaceId) {
      window.open(`/workspace/${workspaceId}/w/${childWorkflowId}`, '_blank', 'noopener,noreferrer')
    }
  }, [childWorkflowId, workspaceId])

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
              ref={nameInputRefCallback}
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
          {/* Locked indicator - clickable to unlock if user has admin permissions, block is locked, and parent is not locked */}
          {isLocked && currentBlock && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                {userPermissions.canAdmin && currentBlock.locked && !isParentLocked ? (
                  <Button
                    variant='ghost'
                    className='p-0'
                    onClick={() => collaborativeBatchToggleLocked([currentBlockId!])}
                    aria-label='Unlock block'
                  >
                    <Unlock className='h-[14px] w-[14px] text-[var(--text-secondary)]' />
                  </Button>
                ) : (
                  <div className='flex items-center justify-center'>
                    <Lock className='h-[14px] w-[14px] text-[var(--text-secondary)]' />
                  </div>
                )}
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>
                <p>
                  {isParentLocked
                    ? 'Parent container is locked'
                    : userPermissions.canAdmin && currentBlock.locked
                      ? 'Unlock block'
                      : 'Block is locked'}
                </p>
              </Tooltip.Content>
            </Tooltip.Root>
          )}
          {/* Rename button */}
          {currentBlock && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  className='p-0'
                  onClick={isRenaming ? handleSaveRename : handleStartRename}
                  disabled={!canEditBlock}
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
          userCanEdit={canEditBlock}
          isConnectionsAtMinHeight={isConnectionsAtMinHeight}
        />
      ) : (
        <div className='flex flex-1 flex-col overflow-hidden pt-[0px]'>
          {/* Subblocks Section */}
          <div
            ref={subBlocksRef}
            className='subblocks-section flex flex-1 flex-col overflow-hidden'
          >
            <div className='flex-1 overflow-y-auto overflow-x-hidden px-[8px] pt-[12px] pb-[8px] [overflow-anchor:none]'>
              {/* Workflow Preview - only for workflow blocks with a selected child workflow */}
              {isWorkflowBlock && childWorkflowId && (
                <>
                  <div className='subblock-content flex flex-col gap-[9.5px]'>
                    <div className='pl-[2px] font-medium text-[13px] text-[var(--text-primary)] leading-none'>
                      Workflow Preview
                    </div>
                    <div className='relative h-[160px] overflow-hidden rounded-[4px] border border-[var(--border)]'>
                      {isLoadingChildWorkflow ? (
                        <div className='flex h-full items-center justify-center bg-[var(--surface-3)]'>
                          <Loader2 className='h-5 w-5 animate-spin text-[var(--text-tertiary)]' />
                        </div>
                      ) : childWorkflowState ? (
                        <>
                          <div className='[&_*:active]:!cursor-grabbing [&_*]:!cursor-grab [&_.react-flow__handle]:!hidden h-full w-full'>
                            <PreviewWorkflow
                              workflowState={childWorkflowState}
                              height={160}
                              width='100%'
                              isPannable={true}
                              defaultZoom={0.6}
                              fitPadding={0.15}
                              cursorStyle='grab'
                              lightweight
                            />
                          </div>
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              <Button
                                type='button'
                                variant='ghost'
                                onClick={handleOpenChildWorkflow}
                                className='absolute right-[6px] bottom-[6px] z-10 h-[24px] w-[24px] cursor-pointer border border-[var(--border)] bg-[var(--surface-2)] p-0 hover:bg-[var(--surface-4)]'
                              >
                                <ExternalLink className='h-[12px] w-[12px]' />
                              </Button>
                            </Tooltip.Trigger>
                            <Tooltip.Content side='top'>Open workflow</Tooltip.Content>
                          </Tooltip.Root>
                        </>
                      ) : (
                        <div className='flex h-full items-center justify-center bg-[var(--surface-3)]'>
                          <span className='text-[13px] text-[var(--text-tertiary)]'>
                            Unable to load preview
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className='subblock-divider px-[2px] pt-[16px] pb-[13px]'>
                    <div className='h-[1.25px]' style={DASHED_DIVIDER_STYLE} />
                  </div>
                </>
              )}
              {subBlocks.length === 0 && !isWorkflowBlock ? (
                <div className='flex h-full items-center justify-center text-center text-[#8D8D8D] text-[13px]'>
                  This block has no subblocks
                </div>
              ) : (
                <div className='flex flex-col'>
                  {regularSubBlocks.map((subBlock, index) => {
                    const stableKey = getSubBlockStableKey(
                      currentBlockId || '',
                      subBlock,
                      subBlockState
                    )
                    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[subBlock.id]
                    const canonicalGroup = canonicalId
                      ? canonicalIndex.groupsById[canonicalId]
                      : undefined
                    const isCanonicalSwap = isCanonicalPair(canonicalGroup)
                    const canonicalMode =
                      canonicalGroup && isCanonicalSwap
                        ? resolveCanonicalMode(
                            canonicalGroup,
                            blockSubBlockValues,
                            canonicalModeOverrides
                          )
                        : undefined

                    const showDivider =
                      index < regularSubBlocks.length - 1 ||
                      (!hasAdvancedOnlyFields && index < subBlocks.length - 1)

                    return (
                      <div key={stableKey} className='subblock-row'>
                        <SubBlock
                          blockId={currentBlockId}
                          config={subBlock}
                          isPreview={false}
                          subBlockValues={subBlockState}
                          disabled={!canEditBlock}
                          fieldDiffStatus={undefined}
                          allowExpandInPreview={false}
                          canonicalToggle={
                            isCanonicalSwap && canonicalMode && canonicalId
                              ? {
                                  mode: canonicalMode,
                                  disabled: !canEditBlock,
                                  onToggle: () => {
                                    if (!currentBlockId) return
                                    const nextMode =
                                      canonicalMode === 'advanced' ? 'basic' : 'advanced'
                                    collaborativeSetBlockCanonicalMode(
                                      currentBlockId,
                                      canonicalId,
                                      nextMode
                                    )
                                  },
                                }
                              : undefined
                          }
                        />
                        {showDivider && (
                          <div className='subblock-divider px-[2px] pt-[16px] pb-[13px]'>
                            <div className='h-[1.25px]' style={DASHED_DIVIDER_STYLE} />
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {hasAdvancedOnlyFields && canEditBlock && (
                    <div className='flex items-center gap-[10px] px-[2px] pt-[14px] pb-[12px]'>
                      <div className='h-[1.25px] flex-1' style={DASHED_DIVIDER_STYLE} />
                      <button
                        type='button'
                        onClick={handleToggleAdvancedMode}
                        className='flex items-center gap-[6px] whitespace-nowrap font-medium text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      >
                        {displayAdvancedOptions
                          ? 'Hide additional fields'
                          : 'Show additional fields'}
                        <ChevronDown
                          className={`h-[14px] w-[14px] transition-transform duration-200 ${displayAdvancedOptions ? 'rotate-180' : ''}`}
                        />
                      </button>
                      <div className='h-[1.25px] flex-1' style={DASHED_DIVIDER_STYLE} />
                    </div>
                  )}

                  {advancedOnlySubBlocks.map((subBlock, index) => {
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
                          disabled={!canEditBlock}
                          fieldDiffStatus={undefined}
                          allowExpandInPreview={false}
                        />
                        {index < advancedOnlySubBlocks.length - 1 && (
                          <div className='subblock-divider px-[2px] pt-[16px] pb-[13px]'>
                            <div className='h-[1.25px]' style={DASHED_DIVIDER_STYLE} />
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
