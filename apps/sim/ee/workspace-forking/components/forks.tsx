'use client'

import { useMemo, useState } from 'react'
import { ChipDropdown } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import { useQueryState, useQueryStates } from 'nuqs'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import type { SettingsAction } from '@/components/settings/settings-header'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { UnsavedChangesModal } from '@/app/workspace/[workspaceId]/components/credential-detail'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { useSettingsUnsavedGuard } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard'
import { ForkActivityPanel } from '@/ee/workspace-forking/components/fork-activity-panel/fork-activity-panel'
import { ForkExcludedWorkflows } from '@/ee/workspace-forking/components/fork-excluded-workflows/fork-excluded-workflows'
import { forkKindLabel } from '@/ee/workspace-forking/components/fork-kind-label'
import {
  ForkLineage,
  forkLineageRootId,
  forkLineageRoots,
} from '@/ee/workspace-forking/components/fork-lineage'
import { ForkMappings, useForkMatrixEditor } from '@/ee/workspace-forking/components/fork-mappings'
import { ForkEdgeDetail } from '@/ee/workspace-forking/components/fork-sync/fork-edge-detail'
import {
  FORK_TABLE_STACK_CLASS,
  ForkTableTabs,
  ForkTableToolbar,
} from '@/ee/workspace-forking/components/fork-table'
import { ForkWorkspaceModal } from '@/ee/workspace-forking/components/fork-workspace-modal/fork-workspace-modal'
import { useForkingAvailability } from '@/ee/workspace-forking/hooks/use-forking-available'
import { useForkForest, useForkMatrix } from '@/ee/workspace-forking/hooks/workspace-fork'
import {
  FORK_EVENT_FILTERS,
  FORK_RESOURCE_FILTERS,
  type ForkTab,
  forkEdgeIdParam,
  forkEdgeIdUrlKeys,
  forkFilterParsers,
  forkFilterUrlKeys,
  forkRootIdParam,
  forkTabParam,
  forkTabUrlKeys,
} from '@/ee/workspace-forking/search-params'
import { useWorkspaceCreationPolicy } from '@/hooks/queries/workspace'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

const TAB_ITEMS: ReadonlyArray<{ id: ForkTab; label: string }> = [
  { id: 'lineage', label: 'Lineage' },
  { id: 'mappings', label: 'Mappings' },
  { id: 'excluded', label: 'Excluded' },
  { id: 'activity', label: 'Activity' },
]

const RESOURCE_FILTER_OPTIONS = FORK_RESOURCE_FILTERS.map((value) => ({
  value,
  label: value === 'all' ? 'All resources' : forkKindLabel(value),
}))

const EVENT_FILTER_LABELS: Record<(typeof FORK_EVENT_FILTERS)[number], string> = {
  all: 'All events',
  fork_content_copy: 'Forks',
  fork_sync: 'Syncs',
  fork_rollback: 'Rollbacks',
}

const EVENT_FILTER_OPTIONS = FORK_EVENT_FILTERS.map((value) => ({
  value,
  label: EVENT_FILTER_LABELS[value],
}))

/** Wide enough to hold "All resources" without the trigger resizing per selection. */
const FILTER_TRIGGER_WIDTH = 'w-[170px]'

/**
 * What the search box narrows, per tab. Activity has none: its feed is keyset-paginated, so a box
 * that only filtered the pages already loaded would silently miss everything older.
 */
const SEARCH_PLACEHOLDER: Partial<Record<ForkTab, string>> = {
  lineage: 'Search workspaces',
  mappings: 'Search resources',
  excluded: 'Search workflows',
}

/**
 * The Forks console.
 *
 * One surface for every fork lineage the viewer can reach: the tree of workspaces, the resource
 * mappings across a whole lineage, each workspace's exclusion list, and the history of every fork,
 * sync, and rollback. Opening an edge from the tree drills into its sync page.
 *
 * Forking and syncing rewrite workflow state and deployments en masse, so the console is
 * workspace-admin only and gated on the workspace's fork entitlement. Every fork route re-checks
 * both, and each row carries its own permission flags — the server remains the boundary.
 */
export function Forks() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { canAdmin, isLoading: permissionsLoading } = useUserPermissionsContext()
  const { available: forkingAvailable, isLoading: availabilityLoading } =
    useForkingAvailability(workspaceId)
  const canUseForking = forkingAvailable && canAdmin

  const { data: creationPolicy } = useWorkspaceCreationPolicy()
  const { navigateToSettings } = useSettingsNavigation()

  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [isForkModalOpen, setIsForkModalOpen] = useState(false)
  const [tab, setTab] = useQueryState(forkTabParam.key, {
    ...forkTabParam.parser,
    ...forkTabUrlKeys,
  })
  const [edgeId, setEdgeId] = useQueryState(forkEdgeIdParam.key, {
    ...forkEdgeIdParam.parser,
    ...forkEdgeIdUrlKeys,
  })
  const [rootId, setRootId] = useQueryState(forkRootIdParam.key, forkRootIdParam.parser)
  const [filters, setFilters] = useQueryStates(forkFilterParsers, forkFilterUrlKeys)

  const forest = useForkForest(workspaceId, canUseForking)
  const nodes = useMemo(() => forest.data?.nodes ?? [], [forest.data?.nodes])
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  /** Names by id, so the activity feed can phrase a row recorded on the other side of an edge. */
  const workspaceNames = useMemo(() => new Map(nodes.map((node) => [node.id, node.name])), [nodes])

  /**
   * Derived from the loaded forest rather than duplicated into state. A stale id — a disconnected
   * edge restored from history, or an old link — resolves to nothing and falls back to the console;
   * the lingering param is harmless and the next selection overwrites it.
   */
  const edgeChild = edgeId ? nodeById.get(edgeId) : undefined
  const edgeParent = edgeChild?.parentId ? nodeById.get(edgeChild.parentId) : undefined

  /** The lineage the matrix lays out: the caller's pick, else the one this workspace belongs to. */
  const activeRootId = rootId ?? forkLineageRootId(nodes, workspaceId) ?? null
  const matrix = useForkMatrix(
    workspaceId,
    activeRootId ?? undefined,
    canUseForking && tab === 'mappings'
  )
  const matrixEditor = useForkMatrixEditor(matrix.data)

  // Called unconditionally, before every early-return gate: a hook placed after one is skipped on
  // gated renders and crashes.
  const guard = useSettingsUnsavedGuard({ isDirty: matrixEditor.dirty })

  const roots = useMemo(() => forkLineageRoots(nodes), [nodes])
  const rootOptions = useMemo(
    () => roots.map((root) => ({ value: root.id, label: root.name })),
    [roots]
  )

  /** Workspaces whose exclusion list the viewer may edit, for the Excluded tab's picker. */
  const excludableWorkspaces = useMemo(() => nodes.filter((node) => node.viewerCanAdmin), [nodes])
  const excludedWorkspaceId = excludableWorkspaces.some((node) => node.id === workspaceId)
    ? workspaceId
    : (excludableWorkspaces[0]?.id ?? workspaceId)
  const [excludedTarget, setExcludedTarget] = useState<string | null>(null)
  const activeExcludedId = excludedTarget ?? excludedWorkspaceId

  if (availabilityLoading || permissionsLoading) {
    return <SettingsPanel />
  }

  if (!canUseForking) {
    return (
      <SettingsPanel>
        <SettingsEmptyState>
          {canAdmin
            ? 'Forking is not available for this workspace.'
            : 'Only workspace admins can manage forks.'}
        </SettingsEmptyState>
      </SettingsPanel>
    )
  }

  if (edgeChild && edgeParent) {
    return (
      <ForkEdgeDetail
        key={edgeChild.id}
        child={edgeChild}
        parent={edgeParent}
        onBack={() => void setEdgeId(null, { history: 'replace' })}
      />
    )
  }

  if (forest.isError) {
    return (
      <SettingsPanel>
        <SettingsEmptyState tone='error'>
          {getErrorMessage(forest.error, 'Failed to load fork lineages')}
        </SettingsEmptyState>
      </SettingsPanel>
    )
  }

  const searchPlaceholder = SEARCH_PLACEHOLDER[tab]

  const openTab = (next: ForkTab) => {
    guard.guardBack(() => {
      // The matrix editor outlives the tab that hosts it, so leaving has to drop its edits too —
      // otherwise Save and Discard would follow the user onto a tab that cannot explain them.
      matrixEditor.discard()
      // The search box means something different per tab, so it never carries across.
      setSearchTerm('')
      void setTab(next)
    })
  }

  // Saving the matrix is the console's only editable state, so its Save and Discard replace the
  // header cluster exactly while it is dirty.
  const actions: SettingsAction[] = matrixEditor.dirty
    ? saveDiscardActions({
        dirty: matrixEditor.dirty,
        saving: matrixEditor.saving,
        onSave: () => void matrixEditor.save(),
        onDiscard: matrixEditor.discard,
      })
    : [
        {
          text: 'Create fork',
          icon: Plus,
          variant: 'primary',
          onSelect: () => setIsForkModalOpen(true),
        },
      ]

  const filterControls =
    tab === 'mappings' ? (
      <>
        <ChipDropdown
          value={activeRootId ?? undefined}
          options={rootOptions}
          matchTriggerWidth={false}
          className={FILTER_TRIGGER_WIDTH}
          aria-label='Lineage'
          placeholder='Pick a lineage'
          onChange={(value) => void setRootId(value)}
        />
        <ChipDropdown
          value={filters.resource}
          options={RESOURCE_FILTER_OPTIONS}
          matchTriggerWidth={false}
          className={FILTER_TRIGGER_WIDTH}
          aria-label='Filter by resource type'
          onChange={(value) =>
            setFilters({
              resource: FORK_RESOURCE_FILTERS.find((entry) => entry === value) ?? null,
            })
          }
        />
      </>
    ) : tab === 'excluded' ? (
      <ChipDropdown
        value={activeExcludedId}
        options={excludableWorkspaces.map((node) => ({ value: node.id, label: node.name }))}
        matchTriggerWidth={false}
        className={FILTER_TRIGGER_WIDTH}
        aria-label='Workspace'
        onChange={setExcludedTarget}
      />
    ) : tab === 'activity' ? (
      <ChipDropdown
        value={filters.event}
        options={EVENT_FILTER_OPTIONS}
        matchTriggerWidth={false}
        className={FILTER_TRIGGER_WIDTH}
        aria-label='Filter by event'
        onChange={(value) =>
          setFilters({ event: FORK_EVENT_FILTERS.find((entry) => entry === value) ?? null })
        }
      />
    ) : undefined

  return (
    <>
      <SettingsPanel actions={actions}>
        <div className={FORK_TABLE_STACK_CLASS}>
          <ForkTableTabs label='Fork views' items={TAB_ITEMS} activeId={tab} onChange={openTab} />
          <ForkTableToolbar
            search={
              searchPlaceholder
                ? { value: searchTerm, onChange: setSearchTerm, placeholder: searchPlaceholder }
                : undefined
            }
            filters={filterControls}
          />

          {tab === 'lineage' ? (
            <ForkLineage
              workspaceId={workspaceId}
              nodes={nodes}
              loading={forest.isLoading}
              searchTerm={searchTerm}
              onOpenEdge={(childWorkspaceId) => void setEdgeId(childWorkspaceId)}
            />
          ) : null}

          {tab === 'mappings' ? (
            activeRootId ? (
              <ForkMappings
                editor={matrixEditor}
                loading={matrix.isLoading}
                searchTerm={searchTerm}
                resourceFilter={filters.resource}
              />
            ) : (
              <SettingsEmptyState variant='inline'>
                No lineages yet. Create a fork to start mapping resources across workspaces.
              </SettingsEmptyState>
            )
          ) : null}

          {tab === 'excluded' ? (
            <ForkExcludedWorkflows workspaceId={activeExcludedId} searchTerm={searchTerm} />
          ) : null}

          {tab === 'activity' ? (
            <ForkActivityPanel
              workspaceId={workspaceId}
              workspaceNames={workspaceNames}
              eventFilter={filters.event}
            />
          ) : null}
        </div>
      </SettingsPanel>

      <UnsavedChangesModal
        open={guard.showUnsavedModal}
        onOpenChange={guard.setShowUnsavedModal}
        onDiscard={guard.confirmDiscard}
      />

      <ForkWorkspaceModal
        open={isForkModalOpen}
        onOpenChange={setIsForkModalOpen}
        sourceWorkspaceId={workspaceId}
        sourceWorkspaceName={nodeById.get(workspaceId)?.name ?? 'Workspace'}
        canFork={creationPolicy?.canCreate ?? true}
        onUpgrade={() => {
          if (isBillingEnabled) navigateToSettings({ section: 'billing' })
        }}
      />
    </>
  )
}
