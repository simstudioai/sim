'use client'

import { useState } from 'react'
import { Chip, ChipCombobox, Skeleton, Tooltip } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import { useQueryState, useQueryStates } from 'nuqs'
import {
  type PaneTab,
  projectPaneOptions,
  projectPaneParsers,
  SYNC_STEPS,
  type SyncStep,
} from '@/app/o/[organizationId]/home/components/project-pane/search-params'
import type { EnvironmentColumn } from '@/app/o/[organizationId]/p/components/environments/mapping-model'
import { RESOURCE_TABS } from '@/app/o/[organizationId]/p/components/environments/mapping-model'
import { ResourceMappingEditor } from '@/app/o/[organizationId]/p/components/environments/resource-mapping-editor'
import { SyncReview } from '@/app/o/[organizationId]/p/components/environments/sync-review'
import { projectParsers } from '@/app/o/[organizationId]/p/search-params'
import {
  type FilterTag,
  ResourceFilterPanel,
  ResourceFilterSection,
  ResourceOptions,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-options'
import { ForkSyncConfirmModal } from '@/ee/workspace-forking/components/fork-sync/fork-sync-confirm-modal'
import { ForkCopyResources } from '@/ee/workspace-forking/components/fork-sync/fork-sync-view'
import { useForkSync } from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'
import { useForkingAvailability } from '@/ee/workspace-forking/hooks/use-forking-available'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

type MappingView = 'unmapped' | 'sync' | 'all'

const MAPPING_VIEW_OPTIONS: { value: MappingView; label: string }[] = [
  { value: 'unmapped', label: 'Not mapped yet' },
  { value: 'sync', label: 'Needed for this sync' },
  { value: 'all', label: 'All mappings' },
]

const STEP_TITLES: Record<SyncStep, string> = {
  mappings: 'Map resources',
  copy: 'Copy resources',
  review: 'Review and sync',
}

interface EnvironmentSyncProps {
  tab: Extract<PaneTab, { kind: 'sync' }>
}

/**
 * One fork's sync with its parent as its own pane tab, in three steps: map resources, choose
 * what to copy, then review the workflow changes and sync. Needs admin on both environments
 * and the fork entitlement, as the server does.
 */
export function EnvironmentSync({ tab }: EnvironmentSyncProps) {
  const { data: workspaces, isPending: workspacesPending } = useWorkspacesQuery()
  const availability = useForkingAvailability(tab.childId)
  const childWorkspace = workspaces?.find((workspace) => workspace.id === tab.childId)
  const parentWorkspace = workspaces?.find(
    (workspace) => workspace.id === childWorkspace?.forkedFromWorkspaceId
  )

  if (workspacesPending || availability.isLoading) {
    return <Skeleton className='m-6 h-32' />
  }
  if (!childWorkspace || !parentWorkspace) {
    return (
      <p className='px-6 py-5 text-[var(--text-muted)] text-small'>
        This fork is no longer connected to an environment you can access.
      </p>
    )
  }
  if (
    !availability.available ||
    childWorkspace.permissions !== 'admin' ||
    parentWorkspace.permissions !== 'admin'
  ) {
    return (
      <p className='px-6 py-5 text-[var(--text-muted)] text-small'>
        Syncing a fork needs admin access to both environments.
      </p>
    )
  }

  const child: EnvironmentColumn = {
    id: childWorkspace.id,
    label: childWorkspace.name,
    name: childWorkspace.name,
    parentId: parentWorkspace.id,
  }
  const parent: EnvironmentColumn = {
    id: parentWorkspace.id,
    label: parentWorkspace.name,
    name: parentWorkspace.name,
    parentId: parentWorkspace.forkedFromWorkspaceId ?? null,
  }
  return <SyncSteps key={tab.id} tab={tab} child={child} parent={parent} />
}

interface SyncStepsProps {
  tab: Extract<PaneTab, { kind: 'sync' }>
  child: EnvironmentColumn
  parent: EnvironmentColumn
}

function SyncSteps({ tab, child, parent }: SyncStepsProps) {
  const [, setPaneParams] = useQueryStates(projectPaneParsers, projectPaneOptions)
  const [kinds, setKinds] = useQueryState(
    'environment-resource',
    projectParsers.resource.withOptions({ history: 'replace', clearOnDefault: true })
  )
  const [mappingSearch, setMappingSearchParam] = useQueryState(
    'mapping-search',
    projectParsers.mappingSearch.withOptions({ history: 'replace', clearOnDefault: true })
  )
  const setMappingSearch = useDebouncedSearchSetter(setMappingSearchParam)
  const [mappingView, setMappingView] = useState<MappingView>('unmapped')
  const sync = {
    workspaceId: child.id,
    workspaceName: child.name,
    otherWorkspaceId: parent.id,
    otherWorkspaceName: parent.name,
    direction: tab.direction,
    enabled: true,
  }
  const controller = useForkSync(sync)
  const allMappings = useForkSync({ ...sync, mappingScope: 'all' })

  const visibleGroups = allMappings.groups.map((group) => ({
    ...group,
    items:
      mappingView !== 'sync'
        ? group.items
        : group.items.filter((entry) =>
            controller.groups.some(
              (syncGroup) =>
                syncGroup.kind === group.kind &&
                syncGroup.items.some((item) => item.sourceId === entry.sourceId)
            )
          ),
  }))
  const mappingEditor = { ...allMappings, groups: visibleGroups }
  const countOf = new Map(visibleGroups.map((group) => [group.kind, group.items.length]))
  const labelOf = new Map(RESOURCE_TABS.map((resourceTab) => [resourceTab.id, resourceTab.label]))
  const kindsLabel =
    kinds.length === 0
      ? 'All'
      : kinds.length === 1
        ? (labelOf.get(kinds[0]) ?? kinds[0])
        : `${kinds.length} types`
  const filterTags: FilterTag[] = [
    ...(kinds.length > 0
      ? [{ label: `Type: ${kindsLabel}`, onRemove: () => void setKinds(null) }]
      : []),
    ...(mappingView !== 'all'
      ? [
          {
            label: MAPPING_VIEW_OPTIONS.find((option) => option.value === mappingView)?.label ?? '',
            onRemove: () => setMappingView('all'),
          },
        ]
      : []),
  ]
  const filterContent = (
    <ResourceFilterPanel>
      <ResourceFilterSection label='Type'>
        <ChipCombobox
          options={RESOURCE_TABS.map((resourceTab) => ({
            value: resourceTab.id,
            label: countOf.get(resourceTab.id)
              ? `${resourceTab.label} (${countOf.get(resourceTab.id)})`
              : resourceTab.label,
          }))}
          multiSelect
          multiSelectValues={kinds}
          onMultiSelectChange={(next) =>
            void setKinds(
              RESOURCE_TABS.filter((resourceTab) => next.includes(resourceTab.id)).map(
                (resourceTab) => resourceTab.id
              )
            )
          }
          overlayLabel={kindsLabel}
          overlayContent={kindsLabel}
          showAllOption
          allOptionLabel='All'
          className='w-full'
        />
      </ResourceFilterSection>
      <ResourceFilterSection label='Show'>
        <ChipCombobox
          options={MAPPING_VIEW_OPTIONS}
          value={mappingView}
          onChange={(next) =>
            setMappingView(
              MAPPING_VIEW_OPTIONS.find((option) => option.value === next)?.value ?? 'unmapped'
            )
          }
          className='w-full'
        />
      </ResourceFilterSection>
    </ResourceFilterPanel>
  )

  const [confirmOpen, setConfirmOpen] = useState(false)
  const mappingChangesPending = allMappings.dirty || allMappings.saving
  const syncBlockedReason = mappingChangesPending
    ? 'Save or discard mapping changes first'
    : controller.syncDisabledReason
  const stepIndex = SYNC_STEPS.indexOf(tab.step)
  const goTo = (step: SyncStep) =>
    void setPaneParams((current) => ({
      tabs: current.tabs.map((entry) => (entry.id === tab.id ? { ...tab, step } : entry)),
    }))
  const source = tab.direction === 'push' ? child : parent
  const target = tab.direction === 'push' ? parent : child

  return (
    <div className='flex h-full min-h-0 flex-col overflow-y-auto'>
      <div className='flex items-center justify-between gap-3 px-6 pt-5 pb-4'>
        <div className='flex min-w-0 flex-col gap-0.5'>
          <h2 className='text-[var(--text-primary)] text-base'>{STEP_TITLES[tab.step]}</h2>
          <p className='flex items-center gap-1 text-[var(--text-muted)] text-caption'>
            Step {stepIndex + 1} of {SYNC_STEPS.length} · {source.label}
            <ArrowRight className='size-[12px]' />
            {target.label}
          </p>
        </div>
        <div className='flex shrink-0 gap-2'>
          <Chip disabled={stepIndex === 0} onClick={() => goTo(SYNC_STEPS[stepIndex - 1])}>
            Back
          </Chip>
          {tab.step !== 'review' ? (
            <Chip
              variant='primary'
              disabled={allMappings.saving}
              onClick={() => {
                if (tab.step === 'mappings' && allMappings.dirty) allMappings.save()
                goTo(SYNC_STEPS[stepIndex + 1])
              }}
            >
              {tab.step === 'mappings' && allMappings.dirty ? 'Save and next' : 'Next'}
            </Chip>
          ) : (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <span className='inline-flex'>
                  <Chip
                    variant='primary'
                    onClick={() => setConfirmOpen(true)}
                    disabled={
                      mappingChangesPending || controller.syncDisabled || controller.isLoading
                    }
                  >
                    {controller.submitting ? 'Syncing…' : 'Sync'}
                  </Chip>
                </span>
              </Tooltip.Trigger>
              {syncBlockedReason ? (
                <Tooltip.Content side='bottom'>{syncBlockedReason}</Tooltip.Content>
              ) : null}
            </Tooltip.Root>
          )}
        </div>
      </div>
      {tab.step === 'mappings' ? (
        <section
          aria-label='Resource mappings'
          className='flex flex-col border-[var(--border)] border-t'
        >
          <ResourceOptions
            search={{
              value: mappingSearch,
              onChange: setMappingSearch,
              onClearAll: () => setMappingSearch(''),
              placeholder: 'Search mappings...',
            }}
            filter={{ content: filterContent, active: filterTags.length > 0 }}
            filterTags={filterTags}
            trailing={
              allMappings.dirty ? (
                <Chip
                  disabled={allMappings.saving || allMappings.submitting}
                  onClick={allMappings.discard}
                >
                  Discard
                </Chip>
              ) : undefined
            }
          />
          {allMappings.isLoading ? (
            <Skeleton className='m-6 h-24' />
          ) : (
            <ResourceMappingEditor
              controller={mappingEditor}
              kinds={kinds}
              search={mappingSearch}
              unmappedOnly={mappingView === 'unmapped'}
              sourceName={source.name}
              targetName={controller.targetWorkspaceName}
            />
          )}
        </section>
      ) : tab.step === 'copy' ? (
        <section
          aria-label='Copy resources'
          className='flex flex-col gap-3 border-[var(--border)] border-t px-6 py-5'
        >
          {controller.isLoading || !controller.hasDiff ? (
            <Skeleton className='h-24' />
          ) : controller.hasVisibleCopyables ? (
            <ForkCopyResources controller={controller} />
          ) : (
            <p className='text-[var(--text-muted)] text-small'>
              Nothing to copy — every resource in {source.label} already exists in {target.label}.
            </p>
          )}
        </section>
      ) : (
        <div className='px-6 pb-5'>
          <SyncReview controller={controller} direction={tab.direction} />
        </div>
      )}
      <ForkSyncConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        controller={controller}
      />
    </div>
  )
}
