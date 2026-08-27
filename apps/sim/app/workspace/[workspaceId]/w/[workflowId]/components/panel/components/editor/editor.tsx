'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, ChipTag, cn, Loader, Tooltip, thinScrollbarClass } from '@sim/emcn'
import { SquareArrowUpRight } from '@sim/emcn/icons'
import { getWorkflowTypeAccent } from '@sim/workflow-renderer'
import type { BlockRetryConfig } from '@sim/workflow-types/workflow'
import { isEqual } from 'es-toolkit'
import { useParams } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { isRetryEligibleBlock } from '@/lib/workflows/blocks/retry-eligibility'
import {
  buildCanonicalIndex,
  getCanonicalSubBlocksForSurface,
  isCanonicalPair,
  resolveCanonicalMode,
} from '@/lib/workflows/subblocks/visibility'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ActionBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/action-bar'
import {
  AvailableData,
  RetrySettings,
  SubBlock,
  SubflowEditor,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components'
import { BlockEditorSections } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/block-editor-sections'
import { EditorEmptyState } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/editor-empty-state/editor-empty-state'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import {
  useBlockConnections,
  useEditorBlockProperties,
  useEditorSubblockLayout,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/hooks'
import { ActiveSearchTargetProvider } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import { LoopTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config'
import { ParallelTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config'
import { getSubBlockStableKey } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/utils'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { isBlockProtected } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/block-protection-utils'
import { PreviewWorkflow } from '@/app/workspace/[workspaceId]/w/components/preview'
import { isLightTileColor } from '@/blocks/icon-color'
import { getBlock } from '@/blocks/registry'
import { useFolderMap } from '@/hooks/queries/folders'
import { isWorkflowEffectivelyLocked } from '@/hooks/queries/utils/folder-tree'
import { useWorkflowMap, useWorkflowState } from '@/hooks/queries/workflows'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useIsBlockActive, useIsCurrentWorkflowExecuting } from '@/stores/execution'
import { usePanelEditorSearchStore, usePanelEditorStore } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/** Stable empty object to avoid creating new references */
const EMPTY_SUBBLOCK_VALUES = {} as Record<string, any>

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
  const { currentBlockId, registerRenameCallback, clearCurrentBlock } = usePanelEditorStore(
    useShallow((state) => ({
      currentBlockId: state.currentBlockId,
      registerRenameCallback: state.registerRenameCallback,
      clearCurrentBlock: state.clearCurrentBlock,
    }))
  )
  const activeSearchTarget = usePanelEditorSearchStore((state) => state.activeSearchTarget)
  const currentWorkflow = useCurrentWorkflow()
  const currentBlock = currentBlockId ? currentWorkflow.getBlockById(currentBlockId) : null
  const isBlockRunning = useIsBlockActive(currentBlockId ?? '')
  const isWorkflowRunning = useIsCurrentWorkflowExecuting()
  const blockConfig = currentBlock ? getBlock(currentBlock.type) : null
  const typeAccent = getWorkflowTypeAccent(currentBlock?.type ?? '')
  const isIntegration = blockConfig?.category === 'tools'
  const title = currentBlock?.name || 'Editor'
  const blockDescription = currentBlock?.data?.description ?? ''
  const isBlockNameSearchHighlighted =
    activeSearchTarget?.targetKind === 'block-name' && activeSearchTarget.blockId === currentBlockId
  const blockNameSearchHighlight =
    isBlockNameSearchHighlighted && activeSearchTarget?.range
      ? {
          range: activeSearchTarget.range,
          rawValue: activeSearchTarget.rawValue,
        }
      : null
  const activeSearchTargetForCurrentBlock =
    activeSearchTarget?.blockId === currentBlockId ? activeSearchTarget : null

  const isSubflow =
    currentBlock && (currentBlock.type === 'loop' || currentBlock.type === 'parallel')

  const subflowConfig = isSubflow ? (currentBlock.type === 'loop' ? LoopTool : ParallelTool) : null

  const isWorkflowBlock =
    currentBlock && (currentBlock.type === 'workflow' || currentBlock.type === 'workflow_input')
  const isNoteBlock = currentBlock?.type === 'note'

  useEffect(() => {
    if (isNoteBlock) clearCurrentBlock()
  }, [clearCurrentBlock, isNoteBlock])

  const params = useParams()
  const workspaceId = params.workspaceId as string

  const subBlocksRef = useRef<HTMLDivElement>(null)

  const userPermissions = useUserPermissionsContext()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const workflowId = activeWorkflowId ?? (params.workflowId as string | undefined)
  const { data: workflows = {} } = useWorkflowMap(workspaceId)
  const { data: folders = {} } = useFolderMap(workspaceId)
  const workflowMetadata = workflowId ? workflows[workflowId] : undefined
  const workflowLocked = isWorkflowEffectivelyLocked(workflowMetadata, folders)

  // Check if block is locked (or inside a locked ancestor) and compute edit permission
  // Locked blocks cannot be edited by anyone (admins can only lock/unlock)
  const blocks = useWorkflowStore((state) => state.blocks)
  const isLocked = currentBlockId ? isBlockProtected(currentBlockId, blocks) : false
  const canEditBlock = userPermissions.canEdit && !workflowLocked && !isLocked

  const { triggerMode } = useEditorBlockProperties(currentBlockId, currentWorkflow.isSnapshotView)

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

  const subBlocksForCanonical = useMemo(
    () => getCanonicalSubBlocksForSurface(blockConfig?.subBlocks || [], triggerMode),
    [blockConfig?.subBlocks, triggerMode]
  )

  const canonicalIndex = useMemo(
    () => buildCanonicalIndex(subBlocksForCanonical),
    [subBlocksForCanonical]
  )
  const canonicalModeOverrides = currentBlock?.data?.canonicalModes

  const { subBlocks, stateToUse: subBlockState } = useEditorSubblockLayout(
    blockConfig || ({} as any),
    currentBlockId || '',
    triggerMode,
    activeWorkflowId,
    blockSubBlockValues,
    currentWorkflow.isSnapshotView
  )

  const { incomingConnections, hasIncomingConnections } = useBlockConnections(currentBlockId || '')

  const {
    collaborativeSetBlockCanonicalMode,
    collaborativeSetBlockRetry,
    collaborativeUpdateBlockDescription,
    collaborativeUpdateBlockName,
  } = useCollaborativeWorkflow()

  const supportsRetry = isRetryEligibleBlock({
    blockType: currentBlock?.type,
    category: blockConfig?.category,
    triggerMode,
  })
  const handleChangeRetry = useCallback(
    (retry: BlockRetryConfig) => {
      if (!currentBlockId) return
      collaborativeSetBlockRetry(currentBlockId, retry)
    },
    [currentBlockId, collaborativeSetBlockRetry]
  )

  const [isRenaming, setIsRenaming] = useState(false)
  const [isEditingDescription, setIsEditingDescription] = useState(false)
  const [availableDataBlockId, setAvailableDataBlockId] = useState<string | null>(null)
  const isAvailableDataOpen = availableDataBlockId === currentBlockId
  const renamingBlockIdRef = useRef<string | null>(null)
  const descriptionBlockIdRef = useRef<string | null>(null)
  const initialEditedNameRef = useRef('')
  const initialEditedDescriptionRef = useRef('')

  useEffect(() => {
    if (!activeSearchTarget || activeSearchTarget.blockId !== currentBlockId) return
    if (activeSearchTarget.targetKind === 'block-name') return
    const container = subBlocksRef.current
    if (!container) return

    const directTarget = container.querySelector<HTMLElement>(
      `[data-workflow-search-subblock-id="${activeSearchTarget.subBlockId}"]`
    )
    const target =
      directTarget ??
      container.querySelector<HTMLElement>(
        `[data-workflow-search-canonical-id="${activeSearchTarget.canonicalSubBlockId}"]`
      )
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeSearchTarget, currentBlockId, subBlocks])

  /**
   * Ref callback that auto-selects the input text when mounted.
   */
  const nameEditorRefCallback = useCallback((element: HTMLSpanElement | null) => {
    if (element) {
      element.textContent = initialEditedNameRef.current
      element.focus()
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
  }, [])

  const descriptionEditorRefCallback = useCallback((element: HTMLDivElement | null) => {
    if (!element) return

    element.textContent = initialEditedDescriptionRef.current
    element.focus()
    const range = document.createRange()
    if (initialEditedDescriptionRef.current) {
      range.selectNodeContents(element)
    } else {
      range.setStart(element, 0)
      range.collapse(true)
    }
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
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

    if (!userPermissions.canEdit || workflowLocked || isBlockProtected(blockId, blocks)) return

    renamingBlockIdRef.current = blockId
    initialEditedNameRef.current = block.name || ''
    setIsRenaming(true)
  }, [userPermissions.canEdit, workflowLocked])

  /**
   * Saves the renamed block using the captured block ID from when rename started.
   */
  const handleSaveRename = useCallback(
    (nextName: string) => {
      const blockIdToRename = renamingBlockIdRef.current
      if (!blockIdToRename || !isRenaming || workflowLocked) return

      const blocks = useWorkflowStore.getState().blocks
      const blockToRename = blocks[blockIdToRename]

      const trimmedName = nextName.trim()
      if (trimmedName && blockToRename && trimmedName !== blockToRename.name) {
        const result = collaborativeUpdateBlockName(blockIdToRename, trimmedName)
        if (!result.success) {
          return
        }
      }
      renamingBlockIdRef.current = null
      setIsRenaming(false)
    },
    [isRenaming, collaborativeUpdateBlockName, workflowLocked]
  )

  /**
   * Handles canceling the rename process.
   */
  const handleCancelRename = useCallback(() => {
    renamingBlockIdRef.current = null
    setIsRenaming(false)
  }, [])

  const handleStartDescriptionEdit = () => {
    const blockId = usePanelEditorStore.getState().currentBlockId
    if (!blockId) return

    const blocks = useWorkflowStore.getState().blocks
    const block = blocks[blockId]
    if (!block) return
    if (!userPermissions.canEdit || workflowLocked || isBlockProtected(blockId, blocks)) return

    descriptionBlockIdRef.current = blockId
    initialEditedDescriptionRef.current = block.data?.description ?? ''
    setIsEditingDescription(true)
  }

  const handleSaveDescription = (nextDescription: string) => {
    const blockId = descriptionBlockIdRef.current
    if (!blockId || !isEditingDescription || workflowLocked) return

    const description = nextDescription.trim()
    const block = useWorkflowStore.getState().blocks[blockId]
    if (block && description !== (block.data?.description ?? '')) {
      collaborativeUpdateBlockDescription(blockId, description)
    }

    descriptionBlockIdRef.current = null
    setIsEditingDescription(false)
  }

  const handleCancelDescriptionEdit = () => {
    descriptionBlockIdRef.current = null
    setIsEditingDescription(false)
  }

  const handleAvailableDataOpenChange = (open: boolean) => {
    setAvailableDataBlockId(open ? currentBlockId : null)
  }

  useEffect(() => {
    registerRenameCallback(handleStartRename)
    return () => registerRenameCallback(null)
  }, [registerRenameCallback, handleStartRename])

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

  if (isNoteBlock) return null

  return (
    <ActiveSearchTargetProvider value={activeSearchTargetForCurrentBlock}>
      <div className='flex h-full max-h-full min-h-0 flex-col overflow-hidden'>
        <div
          className={cn(
            'flex flex-shrink-0 flex-col border-[var(--border)] border-b bg-[var(--bg)] px-3.5 pt-0.5 pb-1.5',
            !currentBlock && 'hidden'
          )}
        >
          <div className='flex min-w-0 items-center gap-3'>
            <div className='flex min-w-0 flex-1 items-center gap-2'>
              {(blockConfig || isSubflow) && (
                <ChipTag
                  variant={isIntegration ? 'brand' : typeAccent.variant}
                  tone={isIntegration ? undefined : typeAccent.tone}
                  brandColor={isIntegration ? blockConfig.bgColor : undefined}
                  brandForeground={
                    isIntegration && isLightTileColor(blockConfig.bgColor) ? 'dark' : 'light'
                  }
                  className='size-5 shrink-0 justify-center p-0'
                >
                  <IconComponent
                    icon={isSubflow ? subflowConfig?.icon : blockConfig?.icon}
                    className='size-[14px]'
                  />
                </ChipTag>
              )}
              {isRenaming ? (
                <span
                  ref={nameEditorRefCallback}
                  contentEditable
                  suppressContentEditableWarning
                  role='textbox'
                  aria-label='Block name'
                  aria-multiline='false'
                  onBlur={(event) => handleSaveRename(event.currentTarget.textContent ?? '')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.blur()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      handleCancelRename()
                    }
                  }}
                  className='min-h-6 min-w-0 truncate font-medium text-[17px] text-[var(--text-primary)] leading-6 outline-none selection:bg-[var(--surface-active)]'
                />
              ) : (
                <h2 className='min-w-0 flex-1'>
                  <button
                    type='button'
                    className={cn(
                      'flex min-h-6 w-full min-w-0 items-center p-0 text-start font-medium text-[17px] text-[var(--text-primary)] leading-6 outline-none focus-visible:underline',
                      canEditBlock ? 'cursor-text' : 'cursor-default'
                    )}
                    title={canEditBlock ? 'Click to rename' : title}
                    onClick={handleStartRename}
                    disabled={!canEditBlock}
                    aria-label={`Rename ${title}`}
                  >
                    <span className='min-w-0 flex-1 truncate'>
                      {blockNameSearchHighlight
                        ? formatDisplayText(title, {
                            workflowSearchHighlight: blockNameSearchHighlight,
                          })
                        : title}
                    </span>
                  </button>
                </h2>
              )}
            </div>
            {currentBlock && (
              <ActionBar
                blockId={currentBlock.id}
                blockType={currentBlock.type}
                disabled={!userPermissions.canEdit || workflowLocked}
                variant='inline'
                inlineActions='run'
                isRunning={isBlockRunning}
                isWorkflowRunning={isWorkflowRunning}
              />
            )}
          </div>

          {currentBlock &&
            (isEditingDescription ? (
              <div
                ref={descriptionEditorRefCallback}
                contentEditable
                suppressContentEditableWarning
                role='textbox'
                aria-label='Block description'
                aria-multiline='true'
                onBlur={(event) => handleSaveDescription(event.currentTarget.textContent ?? '')}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    handleCancelDescriptionEdit()
                  } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    event.currentTarget.blur()
                  }
                }}
                className={cn(
                  'mt-2 h-10 overflow-y-auto whitespace-pre-wrap break-words text-[var(--text-secondary)] text-small leading-5 outline-none selection:bg-[var(--surface-active)]',
                  thinScrollbarClass
                )}
              />
            ) : (
              <button
                type='button'
                className={cn(
                  'mt-2 flex h-10 w-full items-start justify-start overflow-hidden p-0 text-start text-small leading-5 outline-none focus-visible:underline',
                  blockDescription ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]',
                  canEditBlock ? 'cursor-text' : 'cursor-default'
                )}
                title={canEditBlock ? 'Click to edit description' : undefined}
                onClick={handleStartDescriptionEdit}
                disabled={!canEditBlock}
                aria-label={blockDescription ? 'Edit block description' : 'Add block description'}
              >
                <span className='line-clamp-2 block w-full'>
                  {blockDescription || 'Add description'}
                </span>
              </button>
            ))}
        </div>

        {!currentBlockId || !currentBlock ? (
          <EditorEmptyState />
        ) : isSubflow ? (
          <SubflowEditor
            currentBlock={currentBlock}
            currentBlockId={currentBlockId}
            subBlocksRef={subBlocksRef}
            hasIncomingConnections={hasIncomingConnections}
            incomingConnections={incomingConnections}
            userCanEdit={canEditBlock}
            isAvailableDataOpen={isAvailableDataOpen}
            onAvailableDataOpenChange={handleAvailableDataOpenChange}
          />
        ) : (
          <div
            className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden', thinScrollbarClass)}
          >
            {/* Subblocks Section */}
            <div ref={subBlocksRef} className='subblocks-section flex flex-col'>
              <div className='px-4 pt-3 pb-2 [overflow-anchor:none]'>
                {/* Workflow Preview - only for workflow blocks with a selected child workflow */}
                {isWorkflowBlock && childWorkflowId && (
                  <>
                    <div className='subblock-content flex flex-col gap-[9.5px]'>
                      <div className='pl-0.5 font-medium text-[var(--text-primary)] text-small leading-none'>
                        Workflow Preview
                      </div>
                      <div className='relative h-[160px] overflow-hidden rounded-sm border border-[var(--border)]'>
                        {isLoadingChildWorkflow ? (
                          <div className='flex h-full items-center justify-center bg-[var(--surface-3)]'>
                            <Loader className='size-5 text-[var(--text-tertiary)]' animate />
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
                                  className='absolute right-[6px] bottom-1.5 z-10 size-[24px] cursor-pointer border border-[var(--border)] bg-[var(--surface-2)] p-0 hover-hover:bg-[var(--surface-4)]'
                                >
                                  <SquareArrowUpRight className='size-[12px]' />
                                </Button>
                              </Tooltip.Trigger>
                              <Tooltip.Content side='top'>Open workflow</Tooltip.Content>
                            </Tooltip.Root>
                          </>
                        ) : (
                          <div className='flex h-full items-center justify-center bg-[var(--surface-3)]'>
                            <span className='text-[var(--text-tertiary)] text-small'>
                              Unable to load preview
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
                {subBlocks.length === 0 && !isWorkflowBlock ? (
                  <div className='flex h-full items-center justify-center text-center text-[var(--text-placeholder)] text-small'>
                    This block has no subblocks
                  </div>
                ) : (
                  <div className='flex flex-col gap-4'>
                    <BlockEditorSections blockType={currentBlock.type} subBlocks={subBlocks}>
                      {(subBlock) => {
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

                        return (
                          <div key={stableKey} className='subblock-row'>
                            <SubBlock
                              blockId={currentBlockId}
                              config={subBlock}
                              isPreview={false}
                              subBlockValues={subBlockState}
                              disabled={!canEditBlock}
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
                          </div>
                        )
                      }}
                    </BlockEditorSections>
                    {supportsRetry && (
                      <RetrySettings
                        retry={currentBlock.retry}
                        disabled={!canEditBlock}
                        onChange={handleChangeRetry}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>

            {hasIncomingConnections && (
              <AvailableData
                connections={incomingConnections}
                open={isAvailableDataOpen}
                onOpenChange={handleAvailableDataOpenChange}
              />
            )}
          </div>
        )}
      </div>
    </ActiveSearchTargetProvider>
  )
}
