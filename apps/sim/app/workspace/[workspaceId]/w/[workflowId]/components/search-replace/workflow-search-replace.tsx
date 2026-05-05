'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, Search, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button, Input } from '@/components/emcn'
import { getWorkflowSearchDependentClears } from '@/lib/workflows/search-replace/dependencies'
import { indexWorkflowSearchMatches } from '@/lib/workflows/search-replace/indexer'
import {
  getCompatibleResourceReplacementOptions,
  getWorkflowSearchReplacementIssue,
  isConstrainedResourceMatch,
} from '@/lib/workflows/search-replace/replacement-validation'
import { buildWorkflowSearchReplacePlan } from '@/lib/workflows/search-replace/replacements'
import {
  getWorkflowSearchCompatibleResourceMatches,
  workflowSearchMatchMatchesQuery,
} from '@/lib/workflows/search-replace/resource-resolvers'
import { getWorkflowSearchBlocks } from '@/lib/workflows/search-replace/state'
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
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useNotificationStore } from '@/stores/notifications/store'
import { usePanelEditorStore } from '@/stores/panel'
import { useWorkflowSearchReplaceStore } from '@/stores/workflow-search-replace/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

const SEARCH_PANEL_WIDTH = 360
const SEARCH_PANEL_COLLAPSED_HEIGHT = 104
const SEARCH_PANEL_EXPANDED_HEIGHT = 190

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
  const userPermissions = useUserPermissionsContext()
  const addNotification = useNotificationStore((state) => state.addNotification)
  const { collaborativeBatchSetSubblockValues } = useCollaborativeWorkflow()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [isApplying, setIsApplying] = useState(false)
  const [isReplaceExpanded, setIsReplaceExpanded] = useState(false)

  const {
    isOpen,
    query,
    replacement,
    activeMatchId,
    position,
    close,
    open,
    setPosition,
    setQuery,
    setReplacement,
    setActiveMatchId,
  } = useWorkflowSearchReplaceStore()

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
        workflowId,
        isSnapshotView: currentWorkflow.isSnapshotView,
      }),
    [currentWorkflow.blocks, currentWorkflow.isSnapshotView, workflowId, workflowSubblockValues]
  )

  const matches = useMemo(
    () =>
      indexWorkflowSearchMatches({
        workflow: { blocks: searchBlocks },
        query,
        mode: 'all',
        includeResourceMatchesWithoutQuery: true,
        isSnapshotView: currentWorkflow.isSnapshotView,
        workspaceId,
        workflowId,
      }),
    [currentWorkflow.isSnapshotView, query, searchBlocks, workspaceId, workflowId]
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
    () => allHydratedMatches.filter((match) => workflowSearchMatchMatchesQuery(match, query)),
    [allHydratedMatches, query]
  )

  useEffect(() => {
    if (!isOpen) return
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

    return hydratedMatches.filter((match) => match.kind === 'text' && match.editable)
  }, [activeMatch, hydratedMatches])
  const eligibleMatchIds = useMemo(
    () => replaceAllTargetMatches.map((match) => match.id),
    [replaceAllTargetMatches]
  )
  const controlTargetMatches = activeMatch ? [activeMatch] : []
  const usesResourceReplacement = controlTargetMatches.some(isConstrainedResourceMatch)
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
    if (!workflowId || isApplying) return
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

      if (batchUpdates.length === 0) {
        addNotification({
          level: 'info',
          message: 'No eligible matches to replace.',
          workflowId,
        })
        return
      }

      const applied = collaborativeBatchSetSubblockValues(batchUpdates)
      if (!applied) {
        addNotification({
          level: 'error',
          message: 'Replacement could not be applied in the current workflow state.',
          workflowId,
        })
        return
      }

      addNotification({
        level: 'info',
        message: `Replaced ${plan.updates.length} field${plan.updates.length === 1 ? '' : 's'}.`,
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
      className='fixed z-30 flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2.5 pt-0.5 pb-2'
      style={{
        left: `${actualPosition.x}px`,
        top: `${actualPosition.y}px`,
        width: `${SEARCH_PANEL_WIDTH}px`,
        minHeight: `${panelHeight}px`,
      }}
    >
      <div
        className='flex h-[32px] flex-shrink-0 cursor-grab items-center justify-between gap-2.5 bg-[var(--surface-1)] p-0 active:cursor-grabbing'
        onMouseDown={handleMouseDown}
      >
        <div className='flex min-w-0 items-center gap-2'>
          <Search className='h-4 w-4 shrink-0' />
          <span className='truncate font-medium text-[var(--text-primary)] text-sm'>
            Search and replace
          </span>
        </div>
        <div
          className='flex shrink-0 items-center gap-2'
          onMouseDown={(event) => event.stopPropagation()}
        >
          <span className='text-muted-foreground text-xs'>{matchCountLabel}</span>
          <Button variant='ghost' className='!p-1.5 -m-1.5' onClick={close}>
            <X className='h-[16px] w-[16px]' />
          </Button>
        </div>
      </div>

      <div className='grid grid-cols-[2rem_minmax(0,1fr)_2rem_2rem] items-start gap-1.5'>
        <div className='col-span-4 grid grid-cols-subgrid items-center'>
          <Button
            variant='ghost'
            className='h-8 w-8 p-0'
            aria-label={isReplaceExpanded ? 'Hide replace controls' : 'Show replace controls'}
            onClick={() => setIsReplaceExpanded((expanded) => !expanded)}
          >
            <ChevronRight
              className={`h-4 w-4 transition-transform ${isReplaceExpanded ? 'rotate-90' : ''}`}
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
            className='h-8 w-8 p-0'
            disabled={hydratedMatches.length === 0}
            onClick={() => handleMoveActiveMatch(-1)}
          >
            <ChevronUp className='h-4 w-4' />
          </Button>
          <Button
            variant='ghost'
            className='h-8 w-8 p-0'
            disabled={hydratedMatches.length === 0}
            onClick={() => handleMoveActiveMatch(1)}
          >
            <ChevronDown className='h-4 w-4' />
          </Button>
        </div>

        {isReplaceExpanded && (
          <div className='col-start-2 col-end-5'>
            <ReplacementControls
              replacement={replacement}
              compatibleResourceOptions={compatibleResourceOptions}
              usesResourceReplacement={usesResourceReplacement}
              eligibleCount={eligibleMatchIds.length}
              disabled={!userPermissions.canEdit || currentWorkflow.isSnapshotView}
              isApplying={isApplying}
              canReplaceActive={Boolean(
                activeMatch?.editable && hasReplacement && !activeReplacementIssue
              )}
              canReplaceAll={Boolean(
                eligibleMatchIds.length > 0 && hasReplacement && !allReplacementIssue
              )}
              onReplacementChange={setReplacement}
              onReplaceActive={handleReplaceActive}
              onReplaceAll={handleReplaceAll}
            />
          </div>
        )}
      </div>
    </div>
  )
}
