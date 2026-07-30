'use client'

import { useCallback, useMemo, useState } from 'react'
import { Chip, toast } from '@sim/emcn'
import { ArrowLeft, ArrowRight, Library, Plus } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import type { SandboxDependencyIssue } from '@/lib/api/contracts/sandboxes'
import { UnsavedChangesModal } from '@/app/workspace/[workspaceId]/components/credential-detail'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import {
  draftFromSandbox,
  emptyDraft,
  type SandboxDraft,
  SandboxEditor,
  SandboxStatus,
} from '@/app/workspace/[workspaceId]/settings/components/sandboxes/components/sandbox-editor'
import {
  sandboxIdParam,
  sandboxIdUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/sandboxes/search-params'
import { saveDiscardActions } from '@/app/workspace/[workspaceId]/settings/components/save-discard-actions/save-discard-actions'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { useSettingsUnsavedGuard } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard'
import {
  type Sandbox,
  useCreateSandbox,
  useDeleteSandbox,
  useSandboxes,
  useUpdateSandbox,
} from '@/hooks/queries/sandboxes'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

/** Splits the textarea into one entry per row so a rejection keeps its line number. */
function toSubmittedLines(dependencies: string): string[] {
  return dependencies.split('\n')
}

function extractIssues(error: unknown): SandboxDependencyIssue[] {
  const issues = (error as { body?: { issues?: SandboxDependencyIssue[] } })?.body?.issues
  return Array.isArray(issues) ? issues : []
}

export function Sandboxes() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { navigateToSettings } = useSettingsNavigation()

  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [selectedId, setSelectedId] = useQueryState(sandboxIdParam.key, {
    ...sandboxIdParam.parser,
    ...sandboxIdUrlKeys,
  })

  const { data, isLoading } = useSandboxes(workspaceId)
  const createSandbox = useCreateSandbox()
  const updateSandbox = useUpdateSandbox()
  const deleteSandbox = useDeleteSandbox()

  const permissions = useUserPermissionsContext()
  const canAdmin = canMutateWorkspaceSettingsSection('sandboxes', permissions)

  const [draft, setDraft] = useState<SandboxDraft | null>(null)
  const [issues, setIssues] = useState<SandboxDependencyIssue[]>([])
  const [isCreating, setIsCreating] = useState(false)

  // The draft belongs to whatever was open when it was typed. Browser Back
  // clears `selectedId` without going through `closeEditor`, so without this the
  // next sandbox opened would render — and save — the previous one's edits.
  const [draftOwnerId, setDraftOwnerId] = useState<string | null>(null)
  if (draftOwnerId !== selectedId) {
    setDraftOwnerId(selectedId)
    if (draft) {
      setDraft(null)
      setIssues([])
    }
    // Creating and having one open are mutually exclusive, and history can land on
    // a sandbox while create mode is still set — Forward after starting a new one.
    // Leaving both on renders an empty "New sandbox" form whose Delete still points
    // at the restored sandbox.
    if (selectedId) setIsCreating(false)
  }

  const sandboxes = data?.sandboxes ?? []
  const strategy = data?.strategy ?? 'prebuilt'
  const entitled = data?.entitled ?? false

  // Derived, never duplicated into state: a stale id from an old link resolves to
  // nothing and simply falls back to the list.
  const selected = selectedId ? (sandboxes.find((s) => s.id === selectedId) ?? null) : null
  const baseline = isCreating ? null : selected
  const original = useMemo(() => (baseline ? draftFromSandbox(baseline) : emptyDraft()), [baseline])
  const current = draft ?? original
  const isEditing = isCreating || Boolean(selected)
  const isDirty =
    isEditing &&
    (isCreating
      ? current.name.trim().length > 0 || current.dependencies.trim().length > 0
      : current.name !== original.name ||
        current.language !== original.language ||
        current.dependencies !== original.dependencies)

  // Called before every early return — a hook after a gate is skipped on gated renders.
  const guard = useSettingsUnsavedGuard({ isDirty })

  const closeEditor = useCallback(() => {
    setDraft(null)
    setIssues([])
    setIsCreating(false)
    // Opening pushed a history entry; closing must not push another.
    void setSelectedId(null, { history: 'replace' })
  }, [setSelectedId])

  const handleSave = useCallback(async () => {
    setIssues([])
    const body = {
      name: current.name.trim(),
      language: current.language,
      dependencies: toSubmittedLines(current.dependencies),
    }
    try {
      if (isCreating) {
        await createSandbox.mutateAsync({ workspaceId, ...body })
      } else if (selected) {
        await updateSandbox.mutateAsync({ workspaceId, sandboxId: selected.id, ...body })
      }
      closeEditor()
    } catch (error) {
      const lineIssues = extractIssues(error)
      if (lineIssues.length > 0) {
        setIssues(lineIssues)
        return
      }
      toast.error(getErrorMessage(error, 'Failed to save sandbox'))
    }
  }, [current, isCreating, selected, workspaceId, createSandbox, updateSandbox, closeEditor])

  const handleDelete = useCallback(
    async (sandbox: Sandbox) => {
      try {
        await deleteSandbox.mutateAsync({ workspaceId, sandboxId: sandbox.id })
        if (selectedId === sandbox.id) closeEditor()
      } catch (error) {
        toast.error(getErrorMessage(error, 'Failed to delete sandbox'))
      }
    },
    [deleteSandbox, workspaceId, selectedId, closeEditor]
  )

  const filtered = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return sandboxes
    return sandboxes.filter(
      (sandbox) =>
        sandbox.name.toLowerCase().includes(query) ||
        sandbox.dependencies.some((dependency) => dependency.toLowerCase().includes(query))
    )
  }, [sandboxes, searchTerm])

  if (isLoading) {
    return (
      <SettingsPanel>
        <SettingsEmptyState>Loading sandboxes...</SettingsEmptyState>
      </SettingsPanel>
    )
  }

  if (!entitled) {
    return (
      <SettingsPanel>
        <div className='flex flex-col items-center justify-center gap-4 py-20'>
          <div className='text-center'>
            <h3 className='font-medium text-[var(--text-primary)] text-md'>
              Sandboxes require an active Max plan
            </h3>
            <p className='mt-1.5 text-[var(--text-muted)] text-sm'>
              Upgrade to Max and ensure billing is active to install Python or npm packages that
              your Function blocks can import.
            </p>
          </div>
          {canAdmin && (
            <Chip
              variant='primary'
              rightIcon={ArrowRight}
              onClick={() => navigateToSettings({ section: 'billing' })}
            >
              Upgrade to Max
            </Chip>
          )}
        </div>
      </SettingsPanel>
    )
  }

  if (isEditing) {
    const saving = createSandbox.isPending || updateSandbox.isPending
    return (
      <>
        <SettingsPanel
          title={isCreating ? 'New sandbox' : (selected?.name ?? 'Sandbox')}
          description='Packages installed into the image your Function blocks run in.'
          back={{
            text: 'Sandboxes',
            icon: ArrowLeft,
            onSelect: () => guard.guardBack(closeEditor),
          }}
          actions={[
            ...saveDiscardActions({
              dirty: isDirty,
              saving,
              onSave: () => void handleSave(),
              onDiscard: () => {
                setDraft(null)
                setIssues([])
              },
              saveDisabled: !canAdmin || current.name.trim().length === 0,
            }),
            ...(selected && canAdmin
              ? [
                  {
                    text: 'Delete',
                    textTone: 'error' as const,
                    onSelect: () => void handleDelete(selected),
                    disabled: deleteSandbox.isPending,
                  },
                ]
              : []),
          ]}
        >
          <SandboxEditor
            draft={current}
            onChange={setDraft}
            issues={issues}
            disabled={!canAdmin || saving}
            status={selected ? <SandboxStatus sandbox={selected} strategy={strategy} /> : undefined}
          />
        </SettingsPanel>

        <UnsavedChangesModal
          open={guard.showUnsavedModal}
          onOpenChange={guard.setShowUnsavedModal}
          onDiscard={guard.confirmDiscard}
        />
      </>
    )
  }

  return (
    <SettingsPanel
      search={{ value: searchTerm, onChange: setSearchTerm, placeholder: 'Search sandboxes...' }}
      actions={
        canAdmin
          ? [
              {
                text: 'New sandbox',
                icon: Plus,
                variant: 'primary' as const,
                onSelect: () => {
                  setDraft(emptyDraft())
                  setIsCreating(true)
                  // Starting a new one is not editing the open one. Replace rather
                  // than push: this is a mode switch, not a destination.
                  void setSelectedId(null, { history: 'replace' })
                },
              },
            ]
          : []
      }
    >
      <SettingsSection label='Sandboxes'>
        {filtered.length === 0 ? (
          <SettingsEmptyState variant={searchTerm ? 'inline' : 'fill'}>
            {searchTerm
              ? 'No sandboxes match your search.'
              : 'No sandboxes yet. Create one to let Function blocks import packages.'}
          </SettingsEmptyState>
        ) : (
          <div className='flex flex-col gap-3'>
            {filtered.map((sandbox) => (
              <SettingsResourceRow
                key={sandbox.id}
                icon={<Library />}
                title={
                  <button
                    type='button'
                    className='truncate text-left text-[var(--text-body)] text-sm'
                    onClick={() => void setSelectedId(sandbox.id)}
                  >
                    {sandbox.name}
                  </button>
                }
                description={`${sandbox.language === 'python' ? 'Python' : 'JavaScript'} · ${sandbox.dependencies.length} ${sandbox.dependencies.length === 1 ? 'package' : 'packages'}`}
                trailing={
                  canAdmin ? (
                    <RowActionsMenu
                      label={`Actions for ${sandbox.name}`}
                      actions={[
                        { label: 'Edit', onSelect: () => void setSelectedId(sandbox.id) },
                        {
                          label: 'Delete',
                          destructive: true,
                          onSelect: () => void handleDelete(sandbox),
                        },
                      ]}
                    />
                  ) : undefined
                }
              />
            ))}
          </div>
        )}
      </SettingsSection>
    </SettingsPanel>
  )
}
