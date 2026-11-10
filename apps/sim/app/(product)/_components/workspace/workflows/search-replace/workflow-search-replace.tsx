'use client'

import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { IconButton } from '@sim/emcn/button'
import { Input } from '@sim/emcn/field/inputs'
import { OverflowText } from '@sim/emcn/overflow-text'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { useShallow } from 'zustand/react/shallow'
import { toast } from '@/lib/toast/sink'
import { useRegisterGlobalCommands } from '@/app/(product)/_components/workspace/workflows/global-commands/global-commands'
import { ReplacementControls } from '@/app/(product)/_components/workspace/workflows/search-replace/replacement-controls'
import styles from '@/app/(product)/_components/workspace/workflows/search-replace/workflow-search-replace.module.css'
import {
  type ActiveSearchTarget,
  buildWorkflowSearchReplacePlan,
  createCommand,
  dedupeOverlappingWorkflowSearchMatches,
  getBlock,
  getCompatibleResourceReplacementOptions,
  getPanelWidth,
  getTerminalHeight,
  getTransitiveSubBlockDependents,
  getWorkflowSearchBlocks,
  getWorkflowSearchCompatibleResourceMatches,
  getWorkflowSearchMatchResourceGroupKey,
  getWorkflowSearchReplacementIssue,
  type HydratedWorkflowSearchMatch,
  indexWorkflowSearchMatches,
  isConstrainedResourceMatch,
  isWorkflowEffectivelyLocked,
  useCollaborativeWorkflow,
  useCurrentWorkflow,
  useCustomBlockOverlayVersion,
  useCustomTools,
  useFloatBoundarySync,
  useFloatDrag,
  useFloatLayout,
  useFolderMap,
  useMcpTools,
  usePanelEditorSearchStore,
  usePanelEditorStore,
  useScopedWorkflowId,
  useSubBlockStore,
  useUserPermissionsContext,
  useVariablesModalStore,
  useWorkflowMap,
  useWorkflowRegistry,
  useWorkflowResourceReplacementOptions,
  useWorkflowScope,
  useWorkflowSearchReferenceHydration,
  useWorkflowSearchReplaceStore,
  useWorkspaceCredentials,
  WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS,
  type WorkflowSearchReplaceSubflowUpdate,
  workflowSearchMatchMatchesQuery,
} from '@/platform/lib/data/workflows'

const SEARCH_PANEL_WIDTH = 360
const SEARCH_PANEL_COLLAPSED_HEIGHT = 82
const SEARCH_PANEL_EXPANDED_HEIGHT = 156
/** The panel's default inset from the canvas's top-right corner. */
const SEARCH_PANEL_CANVAS_INSET = 32

/**
 * The workflow canvas the panel floats over. The canvas sits below the workspace
 * heading, tabs and control bar and beside the right panel, so its own box is what the legacy
 * viewport arithmetic (sidebar width, panel width, terminal height) stood for.
 */
function getCanvasBounds(panel: HTMLElement | null): DOMRect | null {
  if (typeof document === 'undefined') return null
  const scope = panel?.parentElement ?? document
  return scope.querySelector<HTMLElement>('.react-flow')?.getBoundingClientRect() ?? null
}

function getDefaultSearchPanelPosition(panel: HTMLElement | null) {
  if (typeof window === 'undefined') return { x: 100, y: 100 }

  const canvas = getCanvasBounds(panel)
  if (canvas) {
    return {
      x: canvas.right - SEARCH_PANEL_CANVAS_INSET - SEARCH_PANEL_WIDTH,
      y: canvas.top + SEARCH_PANEL_CANVAS_INSET,
    }
  }

  const panelWidth = getPanelWidth()
  const x = window.innerWidth - 8 - panelWidth - 32 - SEARCH_PANEL_WIDTH
  const y = 40
  return { x, y }
}

function constrainSearchPanelPosition(
  position: { x: number; y: number },
  height: number,
  panel: HTMLElement | null
) {
  if (typeof window === 'undefined') return position

  const canvas = getCanvasBounds(panel)
  if (canvas) {
    return {
      x: Math.max(canvas.left, Math.min(canvas.right - SEARCH_PANEL_WIDTH, position.x)),
      y: Math.max(canvas.top, Math.min(canvas.bottom - height, position.y)),
    }
  }

  const sidebarWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width') || '0'
  )
  const panelWidth = getPanelWidth()
  const terminalHeight = getTerminalHeight()

  return {
    x: Math.max(
      sidebarWidth,
      Math.min(window.innerWidth - panelWidth - SEARCH_PANEL_WIDTH - 8, position.x)
    ),
    y: Math.max(8, Math.min(window.innerHeight - terminalHeight - height - 8, position.y)),
  }
}

function createActiveSearchTarget(
  match: HydratedWorkflowSearchMatch,
  query: string
): ActiveSearchTarget {
  return {
    matchId: match.id,
    blockId: match.blockId,
    subBlockId: match.subBlockId,
    canonicalSubBlockId: match.canonicalSubBlockId,
    valuePath: match.valuePath,
    kind: match.kind,
    targetKind: match.target.kind,
    subBlockType: match.subBlockType,
    rawValue: match.rawValue,
    searchText: match.searchText,
    query,
    range: match.range,
    structuredOccurrenceIndex: match.structuredOccurrenceIndex,
    displayLabel: match.displayLabel,
    resourceGroupKey: match.resource?.resourceGroupKey,
  }
}

/**
 * Search and replace across the workflow's blocks, opened with Mod+F: a draggable floating panel
 * that walks the matches, points the block editor at the current one, and replaces text or a
 * resource reference (credential, file, table, …) in one match or all compatible matches.
 */
export function WorkflowSearchReplace() {
  const { isOpen, open } = useWorkflowSearchReplaceStore(
    useShallow((state) => ({ isOpen: state.isOpen, open: state.open }))
  )
  const focusSearchInputRef = useRef<(() => void) | null>(null)

  useRegisterGlobalCommands([
    createCommand({
      id: 'open-workflow-search-replace',
      handler: () => {
        open()
        focusSearchInputRef.current?.()
      },
    }),
  ])

  return isOpen ? <WorkflowSearchReplacePanel focusRef={focusSearchInputRef} /> : null
}

interface WorkflowSearchReplacePanelProps {
  /** Lets the shortcut re-select the query while the panel is already open. */
  focusRef: RefObject<(() => void) | null>
}

function WorkflowSearchReplacePanel({ focusRef }: WorkflowSearchReplacePanelProps) {
  const { workspaceId } = useWorkflowScope()
  const scopedWorkflowId = useScopedWorkflowId()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const workflowId = activeWorkflowId ?? scopedWorkflowId
  const currentWorkflow = useCurrentWorkflow()
  const workflowSubblockValues = useSubBlockStore((state) =>
    workflowId ? state.workflowValues[workflowId] : undefined
  )
  const { data: workflows = {} } = useWorkflowMap(workspaceId)
  const { data: folders = {} } = useFolderMap(workspaceId)
  const workflowMetadata = workflowId ? workflows[workflowId] : undefined
  const workflowLocked = isWorkflowEffectivelyLocked(workflowMetadata, folders)
  const searchReadOnly = workflowLocked
  const readonlyReason = workflowLocked ? 'Workflow is locked' : undefined
  const userPermissions = useUserPermissionsContext()
  const {
    collaborativeBatchSetSubblockValues,
    collaborativeUpdateIterationCollection,
    collaborativeUpdateIterationCount,
  } = useCollaborativeWorkflow()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const controlsEdges = useScrollEdges<HTMLDivElement>()
  const [isApplying, setIsApplying] = useState(false)
  const [isReplaceExpanded, setIsReplaceExpanded] = useState(false)
  const [resourceReplacementByContext, setResourceReplacementByContext] = useState<
    Record<string, string>
  >({})

  const {
    query,
    replacement: textReplacement,
    activeMatchId,
    position,
    close,
    setPosition,
    setQuery,
    setReplacement,
    setActiveMatchId,
  } = useWorkflowSearchReplaceStore(
    useShallow((state) => ({
      query: state.query,
      replacement: state.replacement,
      activeMatchId: state.activeMatchId,
      position: state.position,
      close: state.close,
      setPosition: state.setPosition,
      setQuery: state.setQuery,
      setReplacement: state.setReplacement,
      setActiveMatchId: state.setActiveMatchId,
    }))
  )
  const prevQueryRef = useRef<string | null>(null)
  const afterReplaceIndexRef = useRef<number | null>(null)
  const { data: workspaceCredentials } = useWorkspaceCredentials({ workspaceId })
  const { data: customTools = [] } = useCustomTools(workspaceId ?? '')
  const { mcpTools } = useMcpTools(workspaceId ?? '')
  const mcpToolNamesById = useMemo(() => {
    const names = new Map<string, string>()
    for (const t of mcpTools) {
      if (!names.has(t.id)) names.set(t.id, t.name)
    }
    return names
  }, [mcpTools])

  const searchBlocks = useMemo(
    () =>
      getWorkflowSearchBlocks({
        blocks: currentWorkflow.blocks,
        subblockValues: workflowSubblockValues,
      }),
    [currentWorkflow.blocks, workflowSubblockValues]
  )

  const credentialTypeById = useMemo(
    () =>
      Object.fromEntries(
        (workspaceCredentials ?? []).map((credential) => [credential.id, credential.type])
      ),
    [workspaceCredentials]
  )

  /** Overlay version invalidates getBlock-resolved tool names in the index. */
  const customBlockOverlayVersion = useCustomBlockOverlayVersion()
  const matches = useMemo(
    () =>
      indexWorkflowSearchMatches({
        workflow: { blocks: searchBlocks },
        query,
        mode: 'all',
        includeResourceMatchesWithoutQuery: true,
        isReadOnly: searchReadOnly,
        readonlyReason,
        workspaceId,
        workflowId,
        credentialTypeById,
        customTools,
        mcpToolNamesById,
      }),
    [
      credentialTypeById,
      customBlockOverlayVersion,
      customTools,
      mcpToolNamesById,
      query,
      readonlyReason,
      searchBlocks,
      searchReadOnly,
      workspaceId,
      workflowId,
    ]
  )

  const allHydratedMatches = useWorkflowSearchReferenceHydration({
    matches,
    workspaceId,
    workflowId,
  })
  const [replacementSearch, setReplacementSearch] = useState('')
  const chosenResourceReplacements = useMemo(
    () => Object.values(resourceReplacementByContext),
    [resourceReplacementByContext]
  )
  const resourceOptions = useWorkflowResourceReplacementOptions({
    matches,
    workspaceId,
    workflowId,
    query: replacementSearch,
    chosen: chosenResourceReplacements,
  })

  const hydratedMatches = useMemo(
    () =>
      dedupeOverlappingWorkflowSearchMatches(
        allHydratedMatches.filter((match) => workflowSearchMatchMatchesQuery(match, query))
      ),
    [allHydratedMatches, query]
  )

  useEffect(() => {
    const focusSearchInput = () => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
    focusSearchInput()
    focusRef.current = focusSearchInput
    return () => {
      focusRef.current = null
      usePanelEditorSearchStore.getState().setActiveSearchTarget(null)
    }
  }, [focusRef])

  const panelHeight = isReplaceExpanded
    ? SEARCH_PANEL_EXPANDED_HEIGHT
    : SEARCH_PANEL_COLLAPSED_HEIGHT
  const { isFloatingLayout, updatePosition } = useFloatLayout({
    ref: panelRef,
    onPositionChange: setPosition,
  })
  const actualPosition = constrainSearchPanelPosition(
    position ?? getDefaultSearchPanelPosition(panelRef.current),
    panelHeight,
    panelRef.current
  )

  const { handleMouseDown } = useFloatDrag({
    position: actualPosition,
    width: SEARCH_PANEL_WIDTH,
    height: panelHeight,
    onPositionChange: updatePosition,
  })

  useFloatBoundarySync({
    isOpen: true,
    position: actualPosition,
    width: SEARCH_PANEL_WIDTH,
    height: panelHeight,
    onPositionChange: updatePosition,
  })

  /* The legacy panel took its geometry as inline style; a Platform view writes it to the element. */
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    panel.style.left = `${actualPosition.x}px`
    panel.style.top = `${actualPosition.y}px`
    panel.style.width = `${SEARCH_PANEL_WIDTH}px`
    panel.style.minHeight = `${panelHeight}px`
  }, [actualPosition.x, actualPosition.y, panelHeight])

  const handleSelectMatch = useCallback(
    (matchId: string) => {
      setActiveMatchId(matchId)
      const match = hydratedMatches.find((candidate) => candidate.id === matchId)
      if (!match) return
      if (!isFloatingLayout()) {
        useVariablesModalStore.getState().setIsOpen(false)
      }
      usePanelEditorStore.getState().setCurrentBlockId(match.blockId)
      usePanelEditorSearchStore.getState().setActiveSearchTarget({
        ...createActiveSearchTarget(match, query),
      })
    },
    [hydratedMatches, isFloatingLayout, query, setActiveMatchId]
  )

  const activeMatchIndex = hydratedMatches.findIndex((match) => match.id === activeMatchId)
  const activeMatch = activeMatchIndex >= 0 ? hydratedMatches[activeMatchIndex] : null
  const replaceAllTargetMatches = useMemo(() => {
    if (!activeMatch) return []
    if (isConstrainedResourceMatch(activeMatch)) {
      return getWorkflowSearchCompatibleResourceMatches(activeMatch, hydratedMatches)
    }
    if (activeMatch.kind === 'workflow-reference') {
      return hydratedMatches.filter(
        (match) => match.kind === 'workflow-reference' && match.editable
      )
    }

    if (activeMatch.kind === 'text') {
      return hydratedMatches.filter((match) => match.kind === 'text' && match.editable)
    }

    return []
  }, [activeMatch, hydratedMatches])
  const eligibleMatchIds = replaceAllTargetMatches.map((match) => match.id)
  const controlTargetMatches = activeMatch ? [activeMatch] : []
  const usesResourceReplacement = controlTargetMatches.some(isConstrainedResourceMatch)
  const resourceReplacementContextKey =
    activeMatch && isConstrainedResourceMatch(activeMatch)
      ? getWorkflowSearchMatchResourceGroupKey(activeMatch)
      : null
  const replacement = resourceReplacementContextKey
    ? (resourceReplacementByContext[resourceReplacementContextKey] ?? '')
    : textReplacement
  const handleReplacementChange = (nextReplacement: string) => {
    if (!resourceReplacementContextKey) {
      setReplacement(nextReplacement)
      return
    }

    setResourceReplacementByContext((current) => ({
      ...current,
      [resourceReplacementContextKey]: nextReplacement,
    }))
  }
  const compatibleResourceOptions = getCompatibleResourceReplacementOptions(
    controlTargetMatches,
    resourceOptions
  )
  const hasReplacement = replacement.trim().length > 0
  const activeReplacementIssue = activeMatch
    ? getWorkflowSearchReplacementIssue({
        matches: [activeMatch],
        replacement,
        resourceOptions,
      })
    : 'No current match.'
  const allReplacementIssue =
    replaceAllTargetMatches.length > 0
      ? getWorkflowSearchReplacementIssue({
          matches: replaceAllTargetMatches,
          replacement,
          resourceOptions,
        })
      : 'No replaceable matches.'

  const applySubflowUpdate = (update: WorkflowSearchReplaceSubflowUpdate) => {
    if (update.fieldId === WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.iterations) {
      if (typeof update.nextValue !== 'number') return
      collaborativeUpdateIterationCount(update.blockId, update.blockType, update.nextValue)
      return
    }

    collaborativeUpdateIterationCollection(
      update.blockId,
      update.blockType,
      String(update.nextValue)
    )
  }

  useEffect(() => {
    const queryChanged = prevQueryRef.current !== query
    prevQueryRef.current = query

    if (hydratedMatches.length === 0) {
      afterReplaceIndexRef.current = null
      if (activeMatchId) setActiveMatchId(null)
      usePanelEditorSearchStore.getState().setActiveSearchTarget(null)
      return
    }

    if (!activeMatchId || !hydratedMatches.some((match) => match.id === activeMatchId)) {
      const replaceIndex = afterReplaceIndexRef.current
      afterReplaceIndexRef.current = null

      if (queryChanged) {
        handleSelectMatch(hydratedMatches[0].id)
      } else if (replaceIndex !== null) {
        handleSelectMatch(hydratedMatches[Math.min(replaceIndex, hydratedMatches.length - 1)].id)
      } else {
        setActiveMatchId(null)
        usePanelEditorSearchStore.getState().setActiveSearchTarget(null)
      }
      return
    }

    const activeHydratedMatch = hydratedMatches.find((match) => match.id === activeMatchId)
    if (!activeHydratedMatch) return
    usePanelEditorSearchStore
      .getState()
      .setActiveSearchTarget(createActiveSearchTarget(activeHydratedMatch, query))
  }, [activeMatchId, handleSelectMatch, hydratedMatches, query, setActiveMatchId])

  const handleMoveActiveMatch = (delta: number) => {
    if (hydratedMatches.length === 0) return
    if (activeMatchIndex < 0) {
      handleSelectMatch(hydratedMatches[delta > 0 ? 0 : hydratedMatches.length - 1].id)
      return
    }
    const nextIndex = (activeMatchIndex + delta + hydratedMatches.length) % hydratedMatches.length
    handleSelectMatch(hydratedMatches[nextIndex].id)
  }

  const handleApply = (matchIds: string[], replaceActiveIndex?: number) => {
    if (!workflowId || isApplying || searchReadOnly) return
    if (replaceActiveIndex !== undefined) afterReplaceIndexRef.current = replaceActiveIndex
    setIsApplying(true)
    let committed = false

    try {
      const selectedIds = new Set(matchIds)
      const plan = buildWorkflowSearchReplacePlan({
        blocks: searchBlocks,
        matches: hydratedMatches,
        selectedMatchIds: selectedIds,
        defaultReplacement: replacement,
        resourceReplacementOptions: resourceOptions,
      })

      if (plan.conflicts.length > 0) {
        const [firstConflict] = plan.conflicts
        toast.error(
          firstConflict?.reason
            ? `Replacement stopped: ${firstConflict.reason}`
            : `Replacement stopped: ${plan.conflicts.length} match changed. Re-run search and try again.`
        )
        return
      }

      const batchUpdates = plan.updates.map((update) => ({
        blockId: update.blockId,
        subblockId: update.subBlockId,
        value: update.nextValue,
        expectedValue: update.previousValue,
      }))

      for (const update of plan.updates) {
        const block = searchBlocks[update.blockId]
        const blockConfig = block ? getBlock(block.type) : null
        if (!blockConfig?.subBlocks) continue

        const dependentClears = getTransitiveSubBlockDependents(blockConfig.subBlocks, [
          update.subBlockId,
        ])
        for (const clear of dependentClears) {
          const alreadyUpdated = batchUpdates.some(
            (candidate) =>
              candidate.blockId === update.blockId && candidate.subblockId === clear.subBlockId
          )
          if (alreadyUpdated) continue

          const currentValue = useSubBlockStore
            .getState()
            .getValue(update.blockId, clear.subBlockId)
          if (currentValue === '' || currentValue === null || currentValue === undefined) continue
          batchUpdates.push({
            blockId: update.blockId,
            subblockId: clear.subBlockId,
            value: '',
            expectedValue: currentValue,
          })
        }
      }

      if (batchUpdates.length === 0 && plan.subflowUpdates.length === 0) {
        toast({ message: 'No eligible matches to replace.' })
        return
      }

      const applied = collaborativeBatchSetSubblockValues(batchUpdates, {
        subflowUpdates: plan.subflowUpdates.map((update) => ({
          blockId: update.blockId,
          blockType: update.blockType,
          fieldId: update.fieldId,
          before: update.previousValue,
          after: update.nextValue,
        })),
      })
      if (!applied) {
        toast.error('Replacement could not be applied in the current workflow state.')
        return
      }

      for (const update of plan.subflowUpdates) {
        applySubflowUpdate(update)
      }

      const replacedCount = plan.updates.length + plan.subflowUpdates.length
      toast({
        message: `Replaced ${replacedCount} field${replacedCount === 1 ? '' : 's'}.`,
      })
      committed = true
    } finally {
      setIsApplying(false)
      if (!committed) afterReplaceIndexRef.current = null
    }
  }

  const handleReplaceActive = () => {
    if (!activeMatch) return
    handleApply([activeMatch.id], activeMatchIndex)
  }

  const handleReplaceAll = () => {
    handleApply(eligibleMatchIds)
  }

  const matchCountLabel =
    hydratedMatches.length === 0
      ? 'No results'
      : activeMatchIndex >= 0
        ? `${activeMatchIndex + 1} of ${hydratedMatches.length}`
        : `0 of ${hydratedMatches.length}`
  return (
    <div
      role='dialog'
      aria-label='Search and replace'
      ref={panelRef}
      className={styles.panel}
      data-material='floating'
      data-elevation='menu'
    >
      <div
        role='presentation'
        className={styles.header}
        onMouseDown={(event) => {
          if (isFloatingLayout()) handleMouseDown(event)
        }}
      >
        <span className={styles.title} data-type='T060'>
          <OverflowText text='Search and replace'>Search and replace</OverflowText>
        </span>
        <div
          role='presentation'
          className={styles.headerActions}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <span className={styles.count} data-type='T052'>
            {matchCountLabel}
          </span>
          <IconButton label='Close search' icon='I105' size='compact' onClick={close} />
        </div>
      </div>

      <div ref={controlsEdges} className={styles.controls}>
        <div className={styles.grid}>
          <IconButton
            label={isReplaceExpanded ? 'Hide replace controls' : 'Show replace controls'}
            icon={isReplaceExpanded ? 'I051' : 'I090'}
            onClick={() => setIsReplaceExpanded((expanded) => !expanded)}
          />
          <div
            role='presentation'
            className={styles.query}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              handleMoveActiveMatch(event.shiftKey ? -1 : 1)
            }}
          >
            <Input
              label='Search'
              inputRef={searchInputRef}
              value={query}
              placeholder='Search'
              onChange={setQuery}
            />
          </div>
          <IconButton
            label='Previous match'
            icon='I023'
            disabled={hydratedMatches.length === 0}
            onClick={() => handleMoveActiveMatch(-1)}
          />
          <IconButton
            label='Next match'
            icon='I102'
            disabled={hydratedMatches.length === 0}
            onClick={() => handleMoveActiveMatch(1)}
          />

          {isReplaceExpanded && (
            <div className={styles.replaceRow}>
              <ReplacementControls
                replacement={replacement}
                compatibleResourceOptions={compatibleResourceOptions}
                usesResourceReplacement={usesResourceReplacement}
                eligibleCount={eligibleMatchIds.length}
                disabled={!userPermissions.canEdit || searchReadOnly}
                isApplying={isApplying}
                canReplaceActive={Boolean(
                  activeMatch?.editable && hasReplacement && !activeReplacementIssue
                )}
                canReplaceAll={Boolean(
                  eligibleMatchIds.length > 0 && hasReplacement && !allReplacementIssue
                )}
                onReplacementChange={handleReplacementChange}
                onReplacementSearchChange={setReplacementSearch}
                onReplaceActive={handleReplaceActive}
                onReplaceAll={handleReplaceAll}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
