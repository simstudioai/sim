'use client'

import { useEffect, useRef, useState } from 'react'
import { ChipConfirmModal, ChipModalTabs, toast } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { formatDate, formatDateTime } from '@sim/utils/formatting'
import { AlertTriangle, Plus } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import type { BackgroundWorkItem, ForkLineageChildApi } from '@/lib/api/contracts/workspace-fork'
import { UnsavedChangesModal } from '@/app/workspace/[workspaceId]/components/credential-detail'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  forkActionParam,
  forkIdParam,
  forkIdUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import { ForkActivityPanel } from '@/app/workspace/[workspaceId]/settings/components/forks/components/fork-activity-panel/fork-activity-panel'
import {
  ForkMappingCategoryPanel,
  useForkMappingEditor,
} from '@/app/workspace/[workspaceId]/settings/components/forks/components/fork-mapping-tab/fork-mapping-tab'
import { ForkWorkspaceModal } from '@/app/workspace/[workspaceId]/settings/components/forks/components/fork-workspace-modal/fork-workspace-modal'
import { PromoteWorkspaceModal } from '@/app/workspace/[workspaceId]/settings/components/forks/components/promote-workspace-modal/promote-workspace-modal'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { saveDiscardActions } from '@/app/workspace/[workspaceId]/settings/components/save-discard-actions/save-discard-actions'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import type { SettingsAction } from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useSettingsUnsavedGuard } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
import { useWorkspaceCreationPolicy, useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useForkLineage, useRollbackFork } from '@/hooks/queries/workspace-fork'
import { useForkingAvailability } from '@/hooks/use-forking-available'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

/**
 * Whether a background job concerns this fork: its creation carries the child id;
 * syncs/rollbacks along its edge only carry the other workspace's name (best-effort
 * on rename, display-only).
 */
function isJobForFork(job: BackgroundWorkItem, fork: ForkLineageChildApi): boolean {
  if (job.metadata?.childWorkspaceId === fork.id) return true
  return (
    (job.kind === 'fork_sync' || job.kind === 'fork_rollback') &&
    job.metadata?.otherWorkspaceName === fork.name
  )
}

/** Syncs only ever run along the parent edge, so every sync/rollback job belongs to it. */
function isParentEdgeJob(job: BackgroundWorkItem): boolean {
  return job.kind === 'fork_sync' || job.kind === 'fork_rollback'
}

interface ForkListRowProps {
  name: string
  subtitle: string
  /** Entries for the row's `...` menu (e.g. Mapping / Activity / Open workspace). */
  actions: Array<{ label: string; onSelect: () => void }>
}

function ForkListRow({ name, subtitle, actions }: ForkListRowProps) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
        <span className='max-w-[200px] truncate text-[var(--text-body)] text-sm'>{name}</span>
        <p className='truncate text-[var(--text-muted)] text-caption'>{subtitle}</p>
      </div>
      <div className='flex flex-shrink-0 items-center gap-1'>
        <RowActionsMenu label='Fork actions' actions={actions} />
      </div>
    </div>
  )
}

interface ForkMappingDetailViewProps {
  title: string
  workspaceId: string
  /** The other side of this workspace's one parent edge. */
  otherWorkspaceId: string
  otherWorkspaceName: string
  onBack: () => void
  /** Header chips shown when the mapping has no pending edits — the caller owns order + variants. */
  actions: SettingsAction[]
}

/**
 * Parent-edge mapping detail: one tab per mapping category (Credentials, Secrets,
 * Tables, ...), each showing that category's source → target pickers. Activity is
 * reached from the list row's `...` menu, not a tab. While the mapping has unsaved
 * edits the header swaps to Discard/Save and leaving the view is guarded.
 */
function ForkMappingDetailView({
  title,
  workspaceId,
  otherWorkspaceId,
  otherWorkspaceName,
  onBack,
  actions,
}: ForkMappingDetailViewProps) {
  const editor = useForkMappingEditor({
    workspaceId,
    otherWorkspaceId,
    otherWorkspaceName,
    enabled: true,
  })

  // Guard leaving the detail view (Back) while the mapping has unsaved edits, and feed
  // the shared settings dirty store so a sidebar section switch confirms too.
  const guard = useSettingsUnsavedGuard({ isDirty: editor.dirty })

  // Active category tab, clamped to the loaded groups so a refetch that drops a kind
  // never strands the view on a missing tab; defaults to the first category.
  const [activeKind, setActiveKind] = useState('')
  const effectiveKind = editor.groups.some((group) => group.kind === activeKind)
    ? activeKind
    : (editor.groups[0]?.kind ?? '')
  const activeGroup = editor.groups.find((group) => group.kind === effectiveKind) ?? null

  const panelActions: SettingsAction[] = editor.dirty
    ? saveDiscardActions({
        dirty: editor.dirty,
        saving: editor.saving,
        onSave: editor.save,
        onDiscard: editor.discard,
      })
    : actions

  return (
    <>
      <SettingsPanel
        back={{ text: 'Forks', icon: ArrowLeft, onSelect: () => guard.guardBack(onBack) }}
        title={title}
        actions={panelActions}
      >
        <div className='flex min-h-0 flex-1 flex-col'>
          {editor.isError ? (
            <SettingsEmptyState variant='inline'>{editor.errorMessage}</SettingsEmptyState>
          ) : editor.isLoading ? null : !editor.hasEntries ? (
            <SettingsEmptyState variant='inline'>
              This workspace's deployed workflows have no mappable references.
            </SettingsEmptyState>
          ) : (
            <>
              <ChipModalTabs
                tabs={editor.groups.map((group) => ({ value: group.kind, label: group.label }))}
                value={effectiveKind}
                onChange={setActiveKind}
              />
              <div className='min-h-[300px] pt-4'>
                {activeGroup ? (
                  <ForkMappingCategoryPanel editor={editor} group={activeGroup} />
                ) : null}
              </div>
            </>
          )}
        </div>
      </SettingsPanel>

      <UnsavedChangesModal
        open={guard.showUnsavedModal}
        onOpenChange={guard.setShowUnsavedModal}
        onDiscard={guard.confirmDiscard}
      />
    </>
  )
}

interface ForkActivityDetailViewProps {
  title: string
  workspaceId: string
  filterJob: (job: BackgroundWorkItem) => boolean
  emptyMessage: string
  onBack: () => void
  actions: SettingsAction[]
}

/** Activity detail for one lineage row, reached from its `...` menu. */
function ForkActivityDetailView({
  title,
  workspaceId,
  filterJob,
  emptyMessage,
  onBack,
  actions,
}: ForkActivityDetailViewProps) {
  return (
    <SettingsPanel
      back={{ text: 'Forks', icon: ArrowLeft, onSelect: onBack }}
      title={title}
      actions={actions}
    >
      <ForkActivityPanel
        backgroundWorkspaceId={workspaceId}
        filterJob={filterJob}
        emptyMessage={emptyMessage}
      />
    </SettingsPanel>
  )
}

interface ForkChildDetailViewProps {
  title: string
  /** Label/value cells for the details grid. */
  fields: Array<{ label: string; value: string }>
  onBack: () => void
  actions: SettingsAction[]
}

/** Child fork detail: a read-only fields grid (its Activity lives in the row's `...` menu). */
function ForkChildDetailView({ title, fields, onBack, actions }: ForkChildDetailViewProps) {
  return (
    <SettingsPanel
      back={{ text: 'Forks', icon: ArrowLeft, onSelect: onBack }}
      title={title}
      actions={actions}
    >
      <div className='grid grid-cols-[1fr_1fr_1fr] gap-x-6 gap-y-3.5'>
        {fields.map((field) => (
          <div key={field.label} className='flex flex-col gap-1'>
            <span className='font-medium text-[var(--text-primary)] text-sm'>{field.label}</span>
            <p className='text-[var(--text-secondary)] text-base'>{field.value}</p>
          </div>
        ))}
      </div>
    </SettingsPanel>
  )
}

/**
 * Forks settings page. The workspace's single parent (if it's a fork) sits in its own
 * "Parent" section, above the "Forks" list of child forks. Each row's `...` menu is the
 * entry point: the parent's has Mapping (a detail whose tabs are the mapping categories)
 * and Activity; child rows have Details and Activity. Mapping and sync are owned by the
 * fork looking UP at its parent - a parent never edits its children's mappings - so both
 * live only on the parent detail. Forking and sync rewrite workflow state and deployments
 * en masse, so the page is workspace-admin only and gated on the workspace's fork
 * entitlement - every fork route re-checks both; the server remains the boundary.
 */
export function Forks() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const { canAdmin, isLoading: permissionsLoading } = useUserPermissionsContext()
  const { available: forkingAvailable, isLoading: availabilityLoading } =
    useForkingAvailability(workspaceId)
  const canUseForking = forkingAvailable && canAdmin

  const { data: workspaces } = useWorkspacesQuery()
  const { data: creationPolicy } = useWorkspaceCreationPolicy()
  const { navigateToSettings } = useSettingsNavigation()
  const lineage = useForkLineage(workspaceId, canUseForking)
  const rollback = useRollbackFork()

  const [searchTerm, setSearchTerm] = useState('')
  const [isForkModalOpen, setIsForkModalOpen] = useState(false)
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false)
  const [confirmRollbackOpen, setConfirmRollbackOpen] = useState(false)
  // Which detail the `...` menu opened for the selected row: 'main' is the row's primary
  // view (the parent's mapping / a child's details); 'activity' is its activity log.
  const [detailMode, setDetailMode] = useState<'main' | 'activity'>('main')

  const [forkAction, setForkAction] = useQueryState(forkActionParam.key, forkActionParam.parser)
  const [selectedForkId, setSelectedForkId] = useQueryState(forkIdParam.key, {
    ...forkIdParam.parser,
    ...forkIdUrlKeys,
  })

  const workspaceName = workspaces?.find((workspace) => workspace.id === workspaceId)?.name
  const canFork = creationPolicy?.canCreate ?? true
  const parent = lineage.data?.parent ?? null
  const forks = lineage.data?.children ?? []
  const undoableRun = lineage.data?.undoableRun ?? null
  const gateLoading = availabilityLoading || permissionsLoading

  // Read-then-strip deep link (`?fork-action=sync`, from the workspace context menu's
  // "Sync workspace" entry): once the gate and lineage settle, open the sync flow when
  // there's a parent edge, then clear the param so it doesn't linger or re-fire.
  const consumedForkActionRef = useRef(false)
  useEffect(() => {
    if (consumedForkActionRef.current || forkAction !== 'sync') return
    if (gateLoading) return
    if (canUseForking && !lineage.isSuccess) return
    consumedForkActionRef.current = true
    if (canUseForking && lineage.data?.parent) setIsSyncModalOpen(true)
    void setForkAction(null, { history: 'replace', scroll: false })
  }, [forkAction, gateLoading, canUseForking, lineage.isSuccess, lineage.data, setForkAction])

  // Rollback undoes the last sync INTO this workspace, restoring each affected
  // workflow to its prior deployed version.
  const runRollback = async () => {
    if (!undoableRun) return
    try {
      await rollback.mutateAsync({
        workspaceId,
        body: { otherWorkspaceId: undoableRun.otherWorkspaceId },
      })
      toast.success(`Undid sync from "${undoableRun.otherName}"`)
      setConfirmRollbackOpen(false)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Undo failed'))
    }
  }

  const openForkWorkspace = (forkId: string) => {
    router.push(`/workspace/${forkId}/w`)
  }

  const openForkDetail = (forkId: string, mode: 'main' | 'activity') => {
    setDetailMode(mode)
    void setSelectedForkId(forkId)
  }

  if (gateLoading) {
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

  const searchLower = searchTerm.trim().toLowerCase()
  const parentVisible =
    parent !== null && (!searchLower || parent.name.toLowerCase().includes(searchLower))
  const filteredForks = forks.filter((fork) => fork.name.toLowerCase().includes(searchLower))
  const hasRows = parent !== null || forks.length > 0

  const showParentDetail = Boolean(selectedForkId && parent && parent.id === selectedForkId)
  const selectedFork =
    selectedForkId && !showParentDetail
      ? (forks.find((fork) => fork.id === selectedForkId) ?? null)
      : null

  // Sync (push/pull) is the parent edge's primary action, so it's the rightmost/black
  // button; Rollback (destructive) and Open workspace sit left of it. Shared by the
  // parent's mapping and activity details.
  const parentHeaderActions: SettingsAction[] = parent
    ? [
        ...(undoableRun
          ? [
              {
                text: 'Rollback',
                variant: 'destructive' as const,
                onSelect: () => setConfirmRollbackOpen(true),
                disabled: rollback.isPending,
                tooltip: `The last sync into this workspace (from ${undoableRun.otherName}) can be undone — it restores each workflow's prior deployed version.`,
              },
            ]
          : []),
        { text: 'Open workspace', onSelect: () => openForkWorkspace(parent.id) },
        {
          text: 'Sync',
          variant: 'primary' as const,
          onSelect: () => setIsSyncModalOpen(true),
          tooltip: `Push to or pull from ${parent.name}`,
        },
      ]
    : []

  return (
    <>
      {showParentDetail && parent ? (
        detailMode === 'activity' ? (
          <ForkActivityDetailView
            key={`${parent.id}:activity`}
            title={parent.name}
            workspaceId={workspaceId}
            filterJob={isParentEdgeJob}
            emptyMessage='No syncs with the parent yet.'
            onBack={() => setSelectedForkId(null)}
            actions={parentHeaderActions}
          />
        ) : (
          <ForkMappingDetailView
            key={parent.id}
            title={parent.name}
            workspaceId={workspaceId}
            otherWorkspaceId={parent.id}
            otherWorkspaceName={parent.name}
            onBack={() => setSelectedForkId(null)}
            actions={parentHeaderActions}
          />
        )
      ) : selectedFork ? (
        detailMode === 'activity' ? (
          <ForkActivityDetailView
            key={`${selectedFork.id}:activity`}
            title={selectedFork.name}
            workspaceId={workspaceId}
            filterJob={(job) => isJobForFork(job, selectedFork)}
            emptyMessage='No activity for this fork yet.'
            onBack={() => setSelectedForkId(null)}
            actions={[
              {
                text: 'Open workspace',
                variant: 'primary',
                onSelect: () => openForkWorkspace(selectedFork.id),
              },
            ]}
          />
        ) : (
          <ForkChildDetailView
            key={selectedFork.id}
            title={selectedFork.name}
            fields={[
              { label: 'Name', value: selectedFork.name },
              { label: 'Forked from', value: workspaceName || 'This workspace' },
              { label: 'Created', value: formatDateTime(new Date(selectedFork.createdAt)) },
            ]}
            onBack={() => setSelectedForkId(null)}
            actions={[
              {
                text: 'Open workspace',
                variant: 'primary',
                onSelect: () => openForkWorkspace(selectedFork.id),
              },
            ]}
          />
        )
      ) : (
        <SettingsPanel
          search={{
            value: searchTerm,
            onChange: setSearchTerm,
            placeholder: 'Search forks...',
          }}
          actions={[
            {
              text: 'Create fork',
              icon: Plus,
              variant: 'primary',
              onSelect: () => setIsForkModalOpen(true),
            },
          ]}
        >
          <div className='min-h-0 flex-1'>
            {lineage.isError ? (
              <div className='flex h-full flex-col items-center justify-center gap-2'>
                <p className='text-[var(--text-error)] text-sm leading-tight'>
                  {getErrorMessage(lineage.error, 'Failed to load forks')}
                </p>
              </div>
            ) : lineage.isLoading ? null : !hasRows ? (
              <SettingsEmptyState>
                Click &quot;Create fork&quot; above to get started
              </SettingsEmptyState>
            ) : (
              <div className='flex flex-col gap-7'>
                {parentVisible && parent !== null && (
                  <SettingsSection label='Parent'>
                    <ForkListRow
                      name={parent.name}
                      subtitle='Parent workspace'
                      actions={[
                        { label: 'Mapping', onSelect: () => openForkDetail(parent.id, 'main') },
                        {
                          label: 'Activity',
                          onSelect: () => openForkDetail(parent.id, 'activity'),
                        },
                        { label: 'Open workspace', onSelect: () => openForkWorkspace(parent.id) },
                      ]}
                    />
                  </SettingsSection>
                )}
                <SettingsSection label='Forks'>
                  {filteredForks.length > 0 ? (
                    <div className='flex flex-col gap-2'>
                      {filteredForks.map((fork) => (
                        <ForkListRow
                          key={fork.id}
                          name={fork.name}
                          subtitle={`Forked ${formatDate(new Date(fork.createdAt))}`}
                          actions={[
                            { label: 'Details', onSelect: () => openForkDetail(fork.id, 'main') },
                            {
                              label: 'Activity',
                              onSelect: () => openForkDetail(fork.id, 'activity'),
                            },
                            {
                              label: 'Open workspace',
                              onSelect: () => openForkWorkspace(fork.id),
                            },
                          ]}
                        />
                      ))}
                    </div>
                  ) : (
                    <SettingsEmptyState variant='inline'>
                      {searchTerm.trim()
                        ? `No forks found matching "${searchTerm}"`
                        : 'No forks yet — click "Create fork" above to get started'}
                    </SettingsEmptyState>
                  )}
                </SettingsSection>
              </div>
            )}
          </div>
        </SettingsPanel>
      )}

      <ForkWorkspaceModal
        open={isForkModalOpen}
        onOpenChange={setIsForkModalOpen}
        sourceWorkspaceId={workspaceId}
        sourceWorkspaceName={workspaceName || 'Workspace'}
        canFork={canFork}
        onUpgrade={() => {
          if (isBillingEnabled) navigateToSettings({ section: 'billing' })
        }}
      />

      <PromoteWorkspaceModal
        open={isSyncModalOpen}
        onOpenChange={setIsSyncModalOpen}
        workspaceId={workspaceId}
        parent={parent}
      />

      <ChipConfirmModal
        open={confirmRollbackOpen}
        onOpenChange={setConfirmRollbackOpen}
        srTitle='Undo last sync'
        title='Undo last sync'
        text={[
          'This restores each affected workflow to its ',
          { text: 'prior deployed version', bold: true },
          ' and removes workflows the sync created. Continue?',
        ]}
        confirm={{
          label: 'Rollback',
          onClick: () => void runRollback(),
          pending: rollback.isPending,
          pendingLabel: 'Rolling back...',
        }}
      >
        <div className='flex items-start gap-1.5 px-2 text-[var(--text-secondary)] text-caption'>
          <AlertTriangle className='mt-[1px] size-[14px] shrink-0' />
          <span>
            Resources copied into this workspace during syncs may remain afterward — rollback
            restores workflows to their prior versions but does not remove copied resources.
          </span>
        </div>
      </ChipConfirmModal>
    </>
  )
}
