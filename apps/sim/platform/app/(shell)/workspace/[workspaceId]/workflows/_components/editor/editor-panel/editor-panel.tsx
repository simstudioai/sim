'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { Icon } from '@sim/emcn/icon'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { Tooltip } from '@sim/emcn/tooltip'
import { isEqual } from 'es-toolkit'
import { useShallow } from 'zustand/react/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { BlockTile } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/block-tile/block-tile'
import { ActiveSearchTargetProvider } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/editor-panel/editor-panel.module.css'
import { formatDisplayText } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'
import { RetrySettings } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/retry-settings/retry-settings'
import {
  type CanonicalToggle,
  SubBlock,
  type SubBlockValues,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/sub-block/sub-block'
import { SubflowEditor } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/subflow-editor/subflow-editor'
import { WorkflowBlockPreview } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/workflow-block-preview/workflow-block-preview'
import {
  type BlockConfig,
  type BlockRetryConfig,
  buildCanonicalIndex,
  evaluateSubBlockCondition,
  getBlock,
  getCanonicalSubBlocksForSurface,
  hasAdvancedValues,
  isCanonicalPair,
  isMcpRuntimeReference,
  isRetryEligibleBlock,
  isStandaloneAdvancedMode,
  isWorkflowBlockAncestorLocked,
  isWorkflowBlockProtected,
  isWorkflowEffectivelyLocked,
  resolveCanonicalMode,
  resolveMcpBlockConfig,
  type SubBlockConfig,
  useCollaborativeWorkflow,
  useCurrentWorkflow,
  useEditorBlockProperties,
  useEditorSubblockLayout,
  useFolderMap,
  usePanelEditorSearchStore,
  usePanelEditorStore,
  useSubBlockStore,
  useUserPermissionsContext,
  useWorkflowMap,
  useWorkflowRegistry,
  useWorkflowScope,
  useWorkflowStore,
} from '@/platform/lib/data/workflow-editor'
import { Box } from '@/platform/lib/data/workflows'

const EMPTY_SUBBLOCK_VALUES: Record<string, unknown> = {}
const DEFAULT_DOCS_URL = 'https://docs.sim.ai/quick-reference'
/** Loop and parallel live on the canvas without a registry entry; their docs and names live here. */
const SUBFLOWS = {
  loop: { name: 'Loop', docsLink: 'https://docs.sim.ai/workflows/blocks/loop' },
  parallel: { name: 'Parallel', docsLink: 'https://docs.sim.ai/workflows/blocks/parallel' },
} as const

/** What the layout hook reads while no block is selected: nothing to lay out. */
const NO_BLOCK_CONFIG: BlockConfig = {
  type: '',
  name: '',
  description: '',
  category: 'blocks',
  bgColor: '',
  icon: Box,
  subBlocks: [],
  tools: { access: [] },
  inputs: {},
  outputs: {},
}

/** A key that remounts an MCP field whenever the server or tool it depends on changes. */
function subBlockKey(blockId: string, subBlock: SubBlockConfig, state: SubBlockValues): string {
  if (subBlock.type === 'mcp-dynamic-args') {
    const server = state.server?.value || 'no-server'
    const tool = state.tool?.value || 'no-tool'
    return `${blockId}-${subBlock.id}-${String(server)}-${String(tool)}`
  }
  if (subBlock.type === 'mcp-tool-selector') {
    return `${blockId}-${subBlock.id}-${String(state.server?.value || 'no-server')}`
  }
  return `${blockId}-${subBlock.id}`
}

/**
 * The selected block's configuration: its name (renamable), lock, docs, then every field its
 * configuration shows for the current mode, the additional fields behind a disclosure and the
 * block's retry policy. A loop or parallel shows its iteration settings instead.
 */
export function EditorPanel() {
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
  const blockConfig = currentBlock ? getBlock(currentBlock.type) : null
  const subflow =
    currentBlock && (currentBlock.type === 'loop' || currentBlock.type === 'parallel')
      ? SUBFLOWS[currentBlock.type]
      : null
  const title = currentBlock?.name || 'Editor'
  const blockNameSearchHighlight =
    activeSearchTarget?.targetKind === 'block-name' &&
    activeSearchTarget.blockId === currentBlockId &&
    activeSearchTarget.range
      ? { range: activeSearchTarget.range, rawValue: activeSearchTarget.rawValue }
      : null
  const activeSearchTargetForCurrentBlock =
    activeSearchTarget?.blockId === currentBlockId ? activeSearchTarget : null
  const isWorkflowBlock =
    currentBlock?.type === 'workflow' || currentBlock?.type === 'workflow_input'
  const isNoteBlock = currentBlock?.type === 'note'

  useEffect(() => {
    if (isNoteBlock) clearCurrentBlock()
  }, [clearCurrentBlock, isNoteBlock])

  const { workspaceId, workflowId: scopedWorkflowId } = useWorkflowScope()
  const subBlocksRef = useRef<HTMLDivElement>(null)
  const bodyRef = useScrollEdges<HTMLDivElement>('vertical', { viewport: subBlocksRef })
  const userPermissions = useUserPermissionsContext()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const workflowId = activeWorkflowId ?? scopedWorkflowId ?? undefined
  const { data: workflows = {} } = useWorkflowMap(workspaceId)
  const { data: folders = {} } = useFolderMap(workspaceId)
  const workflowLocked = isWorkflowEffectivelyLocked(
    workflowId ? workflows[workflowId] : undefined,
    folders
  )

  const blocks = useWorkflowStore((state) => state.blocks)
  const isLocked = currentBlockId ? isWorkflowBlockProtected(currentBlockId, blocks) : false
  const isAncestorLocked = currentBlockId
    ? isWorkflowBlockAncestorLocked(currentBlockId, blocks)
    : false
  const canEditBlock = userPermissions.canEdit && !workflowLocked && !isLocked

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

  const subBlocksForCanonical = useMemo(
    () => getCanonicalSubBlocksForSurface(blockConfig?.subBlocks || [], triggerMode),
    [blockConfig?.subBlocks, triggerMode]
  )
  const canonicalIndex = useMemo(
    () => buildCanonicalIndex(subBlocksForCanonical),
    [subBlocksForCanonical]
  )
  const canonicalModeOverrides = currentBlock?.data?.canonicalModes
  const activeSearchTargetNeedsAdvanced = useMemo(() => {
    if (!activeSearchTarget || activeSearchTarget.blockId !== currentBlockId) return false
    return subBlocksForCanonical.some(
      (subBlock) =>
        subBlock.mode === 'advanced' &&
        (activeSearchTarget.subBlockId === subBlock.id ||
          activeSearchTarget.canonicalSubBlockId === (subBlock.canonicalParamId ?? subBlock.id))
    )
  }, [activeSearchTarget, currentBlockId, subBlocksForCanonical])
  const advancedValuesPresent = useMemo(
    () => hasAdvancedValues(subBlocksForCanonical, blockSubBlockValues, canonicalIndex),
    [subBlocksForCanonical, blockSubBlockValues, canonicalIndex]
  )

  /**
   * View state only: `block.advancedMode` also decides which member of a canonical pair
   * serializes, so opening the disclosure must not write it. Seeded from the stored flag so a
   * block saved with it on still opens expanded.
   */
  const [additionalFieldsExpanded, setAdditionalFieldsExpanded] = useState(advancedMode)
  const [seededFor, setSeededFor] = useState({ advancedMode, currentBlockId })
  if (seededFor.advancedMode !== advancedMode || seededFor.currentBlockId !== currentBlockId) {
    setSeededFor({ advancedMode, currentBlockId })
    setAdditionalFieldsExpanded(advancedMode)
  }

  const displayAdvancedOptions = canEditBlock
    ? additionalFieldsExpanded || activeSearchTargetNeedsAdvanced
    : additionalFieldsExpanded || advancedValuesPresent || activeSearchTargetNeedsAdvanced

  const hasAdvancedOnlyFields = useMemo(
    () =>
      subBlocksForCanonical.some(
        (subBlock) =>
          isStandaloneAdvancedMode(subBlock.mode) &&
          !canonicalIndex.canonicalIdBySubBlockId[subBlock.id] &&
          (!subBlock.condition ||
            evaluateSubBlockCondition(subBlock.condition, blockSubBlockValues))
      ),
    [subBlocksForCanonical, canonicalIndex.canonicalIdBySubBlockId, blockSubBlockValues]
  )

  const { subBlocks, stateToUse } = useEditorSubblockLayout(
    blockConfig ?? NO_BLOCK_CONFIG,
    currentBlockId || '',
    displayAdvancedOptions,
    triggerMode,
    activeWorkflowId,
    blockSubBlockValues,
    currentWorkflow.isSnapshotView
  )
  const subBlockState = stateToUse as SubBlockValues

  const { regularSubBlocks, advancedOnlySubBlocks } = useMemo(() => {
    const regular: SubBlockConfig[] = []
    const advancedOnly: SubBlockConfig[] = []
    for (const subBlock of subBlocks) {
      if (
        isStandaloneAdvancedMode(subBlock.mode) &&
        !canonicalIndex.canonicalIdBySubBlockId[subBlock.id]
      )
        advancedOnly.push(subBlock)
      else regular.push(subBlock)
    }
    return { regularSubBlocks: regular, advancedOnlySubBlocks: advancedOnly }
  }, [subBlocks, canonicalIndex.canonicalIdBySubBlockId])

  const {
    collaborativeSetBlockCanonicalMode,
    collaborativeSetSubblockValue,
    collaborativeUpdateBlockName,
    collaborativeSetBlockRetry,
    collaborativeBatchToggleLocked,
  } = useCollaborativeWorkflow()

  const supportsRetry = isRetryEligibleBlock({
    blockType: currentBlock?.type,
    category: blockConfig?.category,
    triggerMode,
  })
  const showRetrySettings = supportsRetry && displayAdvancedOptions
  const hasAdditionalFields = hasAdvancedOnlyFields || supportsRetry

  const handleChangeRetry = useCallback(
    (retry: BlockRetryConfig) => {
      if (currentBlockId) collaborativeSetBlockRetry(currentBlockId, retry)
    },
    [currentBlockId, collaborativeSetBlockRetry]
  )

  const [isRenaming, setIsRenaming] = useState(false)
  const [editedName, setEditedName] = useState('')
  const renamingBlockIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!activeSearchTarget || activeSearchTarget.blockId !== currentBlockId) return
    if (activeSearchTarget.targetKind === 'block-name') return
    const container = subBlocksRef.current
    if (!container) return
    const target =
      container.querySelector<HTMLElement>(
        `[data-workflow-search-subblock-id="${activeSearchTarget.subBlockId}"]`
      ) ??
      container.querySelector<HTMLElement>(
        `[data-workflow-search-canonical-id="${activeSearchTarget.canonicalSubBlockId}"]`
      )
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeSearchTarget, currentBlockId, subBlocks])

  const nameInputRef = useCallback((element: HTMLInputElement | null) => {
    element?.select()
  }, [])

  /** Reads the stores directly: the panel store calls it through a registered callback. */
  const handleStartRename = useCallback(() => {
    const blockId = usePanelEditorStore.getState().currentBlockId
    if (!blockId) return
    const allBlocks = useWorkflowStore.getState().blocks
    const block = allBlocks[blockId]
    if (!block) return
    if (!userPermissions.canEdit || workflowLocked || isWorkflowBlockProtected(blockId, allBlocks))
      return
    renamingBlockIdRef.current = blockId
    setEditedName(block.name || '')
    setIsRenaming(true)
  }, [userPermissions.canEdit, workflowLocked])

  const handleSaveRename = useCallback(() => {
    const blockIdToRename = renamingBlockIdRef.current
    if (!blockIdToRename || !isRenaming || workflowLocked) return
    const blockToRename = useWorkflowStore.getState().blocks[blockIdToRename]
    const trimmedName = editedName.trim()
    if (trimmedName && blockToRename && trimmedName !== blockToRename.name) {
      const result = collaborativeUpdateBlockName(blockIdToRename, trimmedName)
      if (!result.success) return
    }
    renamingBlockIdRef.current = null
    setIsRenaming(false)
  }, [isRenaming, editedName, collaborativeUpdateBlockName, workflowLocked])

  const handleCancelRename = useCallback(() => {
    renamingBlockIdRef.current = null
    setIsRenaming(false)
    setEditedName('')
  }, [])

  useEffect(() => {
    registerRenameCallback(handleStartRename)
    return () => registerRenameCallback(null)
  }, [registerRenameCallback, handleStartRename])

  /** A rename left running across a selection change would save one block's name to another. */
  useEffect(() => {
    if (!renamingBlockIdRef.current || renamingBlockIdRef.current === currentBlockId) return
    renamingBlockIdRef.current = null
    setIsRenaming(false)
    setEditedName('')
  }, [currentBlockId])

  const handleOpenDocs = useCallback(() => {
    const docsLink = subflow ? subflow.docsLink : blockConfig?.docsLink
    window.open(docsLink || DEFAULT_DOCS_URL, '_blank', 'noopener,noreferrer')
  }, [subflow, blockConfig?.docsLink])

  const childWorkflowId = isWorkflowBlock
    ? (blockSubBlockValues.workflowId as string | undefined)
    : undefined

  const canonicalToggleFor = (subBlock: SubBlockConfig): CanonicalToggle | undefined => {
    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[subBlock.id]
    const canonicalGroup = canonicalId ? canonicalIndex.groupsById[canonicalId] : undefined
    if (!canonicalId || !canonicalGroup || !isCanonicalPair(canonicalGroup)) return undefined
    const mode = resolveCanonicalMode(canonicalGroup, blockSubBlockValues, canonicalModeOverrides)
    return {
      mode,
      disabled:
        !canEditBlock ||
        (currentBlock?.type === 'mcp' &&
          canonicalId === 'tool' &&
          isMcpRuntimeReference(
            resolveMcpBlockConfig(blockSubBlockValues, canonicalModeOverrides).server
          )),
      onToggle: () => {
        if (!currentBlockId) return
        const nextMode = mode === 'advanced' ? 'basic' : 'advanced'
        collaborativeSetBlockCanonicalMode(currentBlockId, canonicalId, nextMode)
        if (currentBlock?.type !== 'mcp' || canonicalId !== 'server') return
        collaborativeSetSubblockValue(currentBlockId, '_toolSchema', null)
        const next = resolveMcpBlockConfig(blockSubBlockValues, {
          ...canonicalModeOverrides,
          server: nextMode,
        })
        if (isMcpRuntimeReference(next.server) && canonicalModeOverrides?.tool !== 'advanced') {
          collaborativeSetSubblockValue(
            currentBlockId,
            'toolReference',
            blockSubBlockValues.toolSelector ?? ''
          )
          collaborativeSetBlockCanonicalMode(currentBlockId, 'tool', 'advanced')
        }
      },
    }
  }

  if (isNoteBlock) return null

  const lockLabel = isAncestorLocked
    ? 'Ancestor container is locked'
    : userPermissions.canAdmin && currentBlock?.locked
      ? 'Unlock block'
      : 'Block is locked'

  return (
    <ActiveSearchTargetProvider value={activeSearchTargetForCurrentBlock}>
      <section className={styles.panel} aria-label='Block editor'>
        <header className={styles.header}>
          <div className={styles.identity}>
            {currentBlock && (blockConfig || subflow) && (
              <BlockTile blockType={currentBlock.type} size='lg' />
            )}
            {isRenaming ? (
              <input
                ref={nameInputRef}
                className={styles.nameInput}
                data-type='T062'
                aria-label='Block name'
                value={editedName}
                onChange={(event) => setEditedName(event.target.value)}
                onBlur={handleSaveRename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSaveRename()
                  else if (event.key === 'Escape') handleCancelRename()
                }}
              />
            ) : (
              <h2
                className={styles.title}
                data-type='T062'
                title={title}
                onDoubleClick={handleStartRename}
                onMouseDown={(event) => {
                  if (event.detail === 2) event.preventDefault()
                }}
              >
                {blockNameSearchHighlight
                  ? formatDisplayText(title, { workflowSearchHighlight: blockNameSearchHighlight })
                  : title}
              </h2>
            )}
          </div>
          <div className={styles.headerActions}>
            {isLocked &&
              currentBlock &&
              currentBlockId &&
              (userPermissions.canAdmin && currentBlock.locked && !isAncestorLocked ? (
                <IconButton
                  label='Unlock block'
                  icon='lock'
                  size='compact'
                  tooltip
                  onClick={() => collaborativeBatchToggleLocked([currentBlockId])}
                />
              ) : (
                <Tooltip label={lockLabel}>
                  <span className={styles.lock} role='img' aria-label={lockLabel}>
                    <Icon name='lock' />
                  </span>
                </Tooltip>
              ))}
            {currentBlock && (
              <IconButton
                label={isRenaming ? 'Save name' : 'Rename block'}
                icon={isRenaming ? 'I072' : 'I036'}
                size='compact'
                tooltip
                disabled={!canEditBlock}
                onClick={isRenaming ? handleSaveRename : handleStartRename}
              />
            )}
            <IconButton
              label='Open docs'
              icon='I082'
              size='compact'
              tooltip
              onClick={handleOpenDocs}
            />
          </div>
        </header>

        {!currentBlockId || !currentBlock ? (
          <p className={styles.empty} data-type='T060'>
            Select a block to edit
          </p>
        ) : subflow ? (
          <SubflowEditor
            currentBlock={currentBlock}
            currentBlockId={currentBlockId}
            subBlocksRef={subBlocksRef}
            userCanEdit={canEditBlock}
          />
        ) : (
          <div ref={bodyRef} className={styles.body}>
            {isWorkflowBlock && childWorkflowId && (
              <WorkflowBlockPreview workspaceId={workspaceId} workflowId={childWorkflowId} />
            )}
            {subBlocks.length === 0 && !isWorkflowBlock ? (
              <p className={styles.empty} data-type='T060'>
                This block has no subblocks
              </p>
            ) : (
              <div className={styles.fields}>
                {regularSubBlocks.map((subBlock) => (
                  <div
                    key={subBlockKey(currentBlockId, subBlock, subBlockState)}
                    className={styles.field}
                    data-tight={subBlock.hideDividerBefore || undefined}
                  >
                    <SubBlock
                      blockId={currentBlockId}
                      config={subBlock}
                      isPreview={false}
                      subBlockValues={subBlockState}
                      disabled={!canEditBlock}
                      allowExpandInPreview={false}
                      canonicalToggle={canonicalToggleFor(subBlock)}
                    />
                  </div>
                ))}
                {hasAdditionalFields && (canEditBlock || displayAdvancedOptions) && (
                  <div className={styles.field}>
                    <Disclosure
                      label='Additional fields'
                      chevron
                      open={displayAdvancedOptions}
                      onOpenChange={() => {
                        if (canEditBlock) setAdditionalFieldsExpanded((expanded) => !expanded)
                      }}
                    >
                      <div className={styles.additional}>
                        {advancedOnlySubBlocks.map((subBlock) => (
                          <div
                            key={subBlockKey(currentBlockId, subBlock, subBlockState)}
                            className={styles.field}
                            data-tight={subBlock.hideDividerBefore || undefined}
                          >
                            <SubBlock
                              blockId={currentBlockId}
                              config={subBlock}
                              isPreview={false}
                              subBlockValues={subBlockState}
                              disabled={!canEditBlock}
                              allowExpandInPreview={false}
                            />
                          </div>
                        ))}
                        {showRetrySettings && (
                          <RetrySettings
                            blockId={currentBlockId}
                            retry={currentBlock.retry}
                            disabled={!canEditBlock}
                            onChange={handleChangeRetry}
                          />
                        )}
                      </div>
                    </Disclosure>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </ActiveSearchTargetProvider>
  )
}
