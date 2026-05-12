'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { Button, Input } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { getWorkflowSearchDependentClears } from '@/lib/workflows/search-replace/dependencies'
import { indexWorkflowSearchMatches } from '@/lib/workflows/search-replace/indexer'
import { buildWorkflowSearchReplacePlan } from '@/lib/workflows/search-replace/replacements'
import {
  dedupeOverlappingWorkflowSearchMatches,
  getCompatibleResourceReplacementOptions,
  getWorkflowSearchCompatibleResourceMatches,
  getWorkflowSearchMatchResourceGroupKey,
  getWorkflowSearchReplacementIssue,
  isConstrainedResourceMatch,
  workflowSearchMatchMatchesQuery,
} from '@/lib/workflows/search-replace/resources'
import { getWorkflowSearchBlocks } from '@/lib/workflows/search-replace/state'
import { WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS } from '@/lib/workflows/search-replace/subflow-fields'
import type { WorkflowSearchReplaceSubflowUpdate } from '@/lib/workflows/search-replace/types'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { createCommand } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import { useWorkflowResourceReplacementOptions } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/search-replace/hooks/use-workflow-resource-replacement-options'
import { useWorkflowSearchReferenceHydration } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/search-replace/hooks/use-workflow-search-reference-hydration'
import { ReplacementControls } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/search-replace/replacement-controls'
import {
  useFloatBoundarySync,
  useFloatDrag,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/float'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import { getBlock } from '@/blocks'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useFolderMap } from '@/hooks/queries/folders'
import { isWorkflowEffectivelyLocked } from '@/hooks/queries/utils/folder-tree'
import { useWorkflowMap } from '@/hooks/queries/workflows'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useNotificationStore } from '@/stores/notifications/store'
import { usePanelEditorStore } from '@/stores/panel'
import { useWorkflowSearchReplaceStore } from '@/stores/workflow-search-replace/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

const SEARCH_PANEL_WIDTH = 360
const SEARCH_PANEL_COLLAPSED_HEIGHT = 82
const SEARCH_PANEL_EXPANDED_HEIGHT = 156

function getDefaultSearchPanelPosition() {
  if (typeof window === 'undefined') return { x: 100, y: 100 }

  const panelWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
  )
  const x = window.innerWidth - 8 - panelWidth - 32 - SEARCH_PANEL_WIDTH
  const y = 40
  return { x, y }
}

function constrainSearchPanelPosition(position: { x: number; y: number }, height: number) {
  if (typeof window === 'undefined') return position

  const sidebarWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width') || '0'
  )
  const panelWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
  )
  const terminalHeight = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--terminal-height') || '0'
  )

  return {
    x: Math.max(
      sidebarWidth,
      Math.min(window.innerWidth - panelWidth - SEARCH_PANEL_WIDTH - 8, position.x)
    ),
    y: Math.max(8, Math.min(window.innerHeight - terminalHeight - height - 8, position.y)),
  }
}

export function WorkflowSearchReplace() {
  const params = useParams()
  const workspaceId = params.workspaceId as string | undefined
  const routeWorkflowId = params.workflowId as string | undefined
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const workflowId = activeWorkflowId ?? routeWorkflowId
  const currentWorkflow = useCurrentWorkflow()
  const workflowSubblockValues = useSubBlockStore((state) =>
    workflowId ? state.workflowValues[workflowId] : undefined
  )
  const { data: workflows = {} } = useWorkflowMap(workspaceId)
  const { data: folders = {} } = useFolderMap(workspaceId)
  const workflowMetadata = workflowId ? workflows[workflowId] : undefined
  const workflowLocked = isWorkflowEffectivelyLocked(workflowMetadata, folders)
  const searchReadOnly = currentWorkflow.isSnapshotView || workflowLocked
  const readonlyReason = currentWorkflow.isSnapshotView
    ? 'Snapshot view is readonly'
    : workflowLocked
      ? 'Workflow is locked'
      : undefined
  const userPermissions = useUserPermissionsContext()
  const addNotification = useNotificationStore((state) => state.addNotification)
  const {
    collaborativeBatchSetSubblockValues,
    collaborativeUpdateIterationCollection,
    collaborativeUpdateIterationCount,
  } = useCollaborativeWorkflow()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [isApplying, setIsApplying] = useState(false)
  const [isReplaceExpanded, setIsReplaceExpanded] = useState(false)
  const [resourceReplacementByContext, setResourceReplacementByContext] = useState<
    Record<string, string>
  >({})

  const {
    isOpen,
    query,
    replacement: textReplacement,
    activeMatchId,
    position,
    close,
    open,
    setPosition,
    setQuery,
    setReplacement,
    setActiveMatchId,
  } = useWorkflowSearchReplaceStore(
    useShallow((state) => ({
      isOpen: state.isOpen,
      query: state.query,
      replacement: state.replacement,
      activeMatchId: state.activeMatchId,
      position: state.position,
      close: state.close,
      open: state.open,
      setPosition: state.setPosition,
      setQuery: state.setQuery,
      setReplacement: state.setReplacement,
      setActiveMatchId: state.setActiveMatchId,
    }))
  )
  const { data: workspaceCredentials } = useWorkspaceCredentials({ workspaceId, enabled: isOpen })

  useRegisterGlobalCommands([
    createCommand({
      id: 'open-workflow-search-replace',
      handler: () => {
        open()
        requestAnimationFrame(() => {
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
        })
      },
    }),
  ])

  const searchBlocks = useMemo(
    () =>
      getWorkflowSearchBlocks({
        blocks: currentWorkflow.blocks,
        isSnapshotView: currentWorkflow.isSnapshotView,
        subblockValues: workflowSubblockValues,
      }),
    [currentWorkflow.blocks, currentWorkflow.isSnapshotView, workflowSubblockValues]
  )

  const credentialTypeById = useMemo(
    () =>
      Object.fromEntries(
        (workspaceCredentials ?? []).map((credential) => [credential.id, credential.type])
      ),
    [workspaceCredentials]
  )

  const matches = useMemo(
    () =>
      indexWorkflowSearchMatches({
        workflow: { blocks: searchBlocks },
        query,
        mode: 'all',
        includeResourceMatchesWithoutQuery: true,
        isSnapshotView: currentWorkflow.isSnapshotView,
        isReadOnly: searchReadOnly,
        readonlyReason,
        workspaceId,
        workflowId,
        credentialTypeById,
      }),
    [
      currentWorkflow.isSnapshotView,
      credentialTypeById,
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
  const resourceOptions = useWorkflowResourceReplacementOptions({
    matches,
    workspaceId,
    workflowId,
  })

  const hydratedMatches = useMemo(
    () =>
      dedupeOverlappingWorkflowSearchMatches(
        allHydratedMatches.filter((match) => workflowSearchMatchMatchesQuery(match, query))
      ),
    [allHydratedMatches, query]
  )

  useEffect(() => {
    if (!isOpen) {
      usePanelEditorStore.getState().setActiveSearchTarget(null)
      return
    }
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
  }, [isOpen])

  const panelHeight = isReplaceExpanded
    ? SEARCH_PANEL_EXPANDED_HEIGHT
    : SEARCH_PANEL_COLLAPSED_HEIGHT
  const actualPosition = useMemo(
    () => constrainSearchPanelPosition(position ?? getDefaultSearchPanelPosition(), panelHeight),
    [panelHeight, position]
  )

  const { handleMouseDown } = useFloatDrag({
    position: actualPosition,
    width: SEARCH_PANEL_WIDTH,
    height: panelHeight,
    onPositionChange: setPosition,
  })

  useFloatBoundarySync({
    isOpen,
    position: actualPosition,
    width: SEARCH_PANEL_WIDTH,
    height: panelHeight,
    onPositionChange: setPosition,
  })

  const handleSelectMatch = useCallback(
    (matchId: string) => {
      setActiveMatchId(matchId)
      const match = hydratedMatches.find((candidate) => candidate.id === matchId)
      if (!match) return
      usePanelEditorStore.getState().setCurrentBlockId(match.blockId)
      usePanelEditorStore.getState().setActiveSearchTarget({
        matchId: match.id,
        blockId: match.blockId,
        subBlockId: match.subBlockId,
        canonicalSubBlockId: match.canonicalSubBlockId,
        valuePath: match.valuePath,
        kind: match.kind,
        resourceGroupKey: match.resource?.resourceGroupKey,
      })
    },
    [hydratedMatches, setActiveMatchId]
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
  const eligibleMatchIds = useMemo(
    () => replaceAllTargetMatches.map((match) => match.id),
    [replaceAllTargetMatches]
  )
  const controlTargetMatches = activeMatch ? [activeMatch] : []
  const usesResourceReplacement = controlTargetMatches.some(isConstrainedResourceMatch)
  const resourceReplacementContextKey =
    activeMatch && isConstrainedResourceMatch(activeMatch)
      ? getWorkflowSearchMatchResourceGroupKey(activeMatch)
      : null
  const replacement = resourceReplacementContextKey
    ? (resourceReplacementByContext[resourceReplacementContextKey] ?? '')
    : textReplacement
  const handleReplacementChange = useCallback(
    (nextReplacement: string) => {
      if (!resourceReplacementContextKey) {
        setReplacement(nextReplacement)
        return
      }

      setResourceReplacementByContext((current) => ({
        ...current,
        [resourceReplacementContextKey]: nextReplacement,
      }))
    },
    [resourceReplacementContextKey, setReplacement]
  )
  const compatibleResourceOptions = useMemo(
    () => getCompatibleResourceReplacementOptions(controlTargetMatches, resourceOptions),
    [controlTargetMatches, resourceOptions]
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

  const applySubflowUpdate = useCallback(
    (update: WorkflowSearchReplaceSubflowUpdate) => {
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
    },
    [collaborativeUpdateIterationCollection, collaborativeUpdateIterationCount]
  )

  useEffect(() => {
    if (!isOpen) return

    if (hydratedMatches.length === 0) {
      if (activeMatchId) setActiveMatchId(null)
      usePanelEditorStore.getState().setActiveSearchTarget(null)
      return
    }

    if (!activeMatchId || !hydratedMatches.some((match) => match.id === activeMatchId)) {
      handleSelectMatch(hydratedMatches[0].id)
    }
  }, [activeMatchId, handleSelectMatch, hydratedMatches, isOpen, setActiveMatchId])

  if (!isOpen) return null

  const handleMoveActiveMatch = (delta: number) => {
    if (hydratedMatches.length === 0) return
    const currentIndex = activeMatchIndex >= 0 ? activeMatchIndex : 0
    const nextIndex = (currentIndex + delta + hydratedMatches.length) % hydratedMatches.length
    handleSelectMatch(hydratedMatches[nextIndex].id)
  }

  const handleApply = (matchIds: string[]) => {
    if (!workflowId || isApplying || searchReadOnly) return
    setIsApplying(true)

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
        addNotification({
          level: 'error',
          message: firstConflict?.reason
            ? `Replacement stopped: ${firstConflict.reason}`
            : `Replacement stopped: ${plan.conflicts.length} match changed. Re-run search and try again.`,
          workflowId,
        })
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

        const dependentClears = getWorkflowSearchDependentClears(
          blockConfig.subBlocks,
          update.subBlockId
        )
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
        addNotification({
          level: 'info',
          message: 'No eligible matches to replace.',
          workflowId,
        })
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
        addNotification({
          level: 'error',
          message: 'Replacement could not be applied in the current workflow state.',
          workflowId,
        })
        return
      }

      for (const update of plan.subflowUpdates) {
        applySubflowUpdate(update)
      }

      const replacedCount = plan.updates.length + plan.subflowUpdates.length
      addNotification({
        level: 'info',
        message: `Replaced ${replacedCount} field${replacedCount === 1 ? '' : 's'}.`,
        workflowId,
      })
    } finally {
      setIsApplying(false)
    }
  }

  const handleReplaceActive = () => {
    if (!activeMatch) return
    handleApply([activeMatch.id])
  }

  const handleReplaceAll = () => {
    handleApply(eligibleMatchIds)
  }

  const matchCountLabel =
    hydratedMatches.length === 0
      ? 'No results'
      : `${activeMatchIndex >= 0 ? activeMatchIndex + 1 : 1} of ${hydratedMatches.length}`
  return (
    <div
      role='dialog'
      aria-label='Search and replace'
      className='fixed z-[var(--z-dropdown)] flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2.5 pt-0.5 pb-2'
      style={{
        left: `${actualPosition.x}px`,
        top: `${actualPosition.y}px`,
        width: `${SEARCH_PANEL_WIDTH}px`,
        minHeight: `${panelHeight}px`,
      }}
    >
      <div
        role='presentation'
        className='flex h-[32px] flex-shrink-0 cursor-grab items-center justify-between gap-2.5 bg-[var(--surface-1)] p-0 active:cursor-grabbing'
        onMouseDown={handleMouseDown}
      >
        <div className='flex min-w-0 items-center'>
          <span className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
            Search and replace
          </span>
        </div>
        <div
          role='presentation'
          className='flex shrink-0 items-center gap-2'
          onMouseDown={(event) => event.stopPropagation()}
        >
          <span className='text-[var(--text-muted)] text-xs'>{matchCountLabel}</span>
          <Button variant='ghost' className='size-[26px] p-0' onClick={close}>
            <X className='size-[14px]' />
          </Button>
        </div>
      </div>

      <div className='grid grid-cols-[2rem_minmax(0,1fr)_2rem_2rem] items-start gap-1.5'>
        <Button
          variant='ghost'
          className='size-8 p-0'
          aria-label={isReplaceExpanded ? 'Hide replace controls' : 'Show replace controls'}
          onClick={() => setIsReplaceExpanded((expanded) => !expanded)}
        >
          <ChevronRight
            className={cn(
              'h-[14px] w-[14px] text-[var(--text-icon)] transition-transform',
              isReplaceExpanded && 'rotate-90'
            )}
          />
        </Button>
        <Input
          ref={searchInputRef}
          value={query}
          placeholder='Search'
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            handleMoveActiveMatch(event.shiftKey ? -1 : 1)
          }}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          variant='ghost'
          className='size-8 p-0'
          disabled={hydratedMatches.length === 0}
          onClick={() => handleMoveActiveMatch(-1)}
        >
          <ChevronUp className='size-[14px] text-[var(--text-icon)]' />
        </Button>
        <Button
          variant='ghost'
          className='size-8 p-0'
          disabled={hydratedMatches.length === 0}
          onClick={() => handleMoveActiveMatch(1)}
        >
          <ChevronDown className='size-[14px] text-[var(--text-icon)]' />
        </Button>

        {isReplaceExpanded && (
          <div className='col-start-2 col-end-5'>
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
              onReplaceActive={handleReplaceActive}
              onReplaceAll={handleReplaceAll}
            />
          </div>
        )}
      </div>
    </div>
  )
}
