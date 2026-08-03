'use client'

import { useCallback, useMemo, useState } from 'react'
import { ChipConfirmModal, toast } from '@sim/emcn'
import { ArrowLeft, Plus } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { CodeIcon } from '@/components/icons'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import type { SandboxDependencyIssue } from '@/lib/api/contracts/sandboxes'
import { UnsavedChangesModal } from '@/app/workspace/[workspaceId]/components/credential-detail'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  SandboxEditor,
  SandboxStatus,
} from '@/app/workspace/[workspaceId]/settings/components/sandboxes/components/sandbox-editor'
import {
  sandboxIdParam,
  sandboxIdUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/sandboxes/search-params'
import {
  draftFromSandbox,
  emptyDraft,
  extractIssues,
  SANDBOX_UPGRADE_DESCRIPTION,
  SANDBOX_UPGRADE_TITLE,
  type SandboxDraft,
  sandboxDeleteConfirmText,
  toSubmittedLines,
} from '@/app/workspace/[workspaceId]/settings/components/sandboxes/utils'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsUpgradeNotice } from '@/app/workspace/[workspaceId]/settings/components/settings-upgrade-notice'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { useSettingsUnsavedGuard } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard'
import {
  type Sandbox,
  useCreateSandbox,
  useDeleteSandbox,
  useSandboxes,
  useUpdateSandbox,
} from '@/hooks/queries/sandboxes'

export function Sandboxes() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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
    // The confirmation belongs to the sandbox that opened it. Browser Back unmounts
    // the modal without closing it, so leaving this set would re-open it against
    // whichever sandbox is selected next — and delete that one instead.
    setShowDeleteConfirm(false)
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
      setShowDeleteConfirm(false)
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
        <SettingsUpgradeNotice
          title={SANDBOX_UPGRADE_TITLE}
          description={SANDBOX_UPGRADE_DESCRIPTION}
          canUpgrade={canAdmin}
        />
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
              creating: isCreating,
            }),
            ...(selected && canAdmin
              ? [
                  {
                    id: 'delete',
                    text: deleteSandbox.isPending ? 'Deleting...' : 'Delete',
                    onSelect: () => setShowDeleteConfirm(true),
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

        {selected && (
          <ChipConfirmModal
            open={showDeleteConfirm}
            onOpenChange={setShowDeleteConfirm}
            srTitle='Delete Sandbox'
            title='Delete Sandbox'
            text={sandboxDeleteConfirmText(selected.name)}
            confirm={{ label: 'Delete', onClick: () => void handleDelete(selected) }}
          />
        )}

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
      {filtered.length === 0 ? (
        <SettingsEmptyState variant={searchTerm ? 'inline' : 'fill'}>
          {searchTerm
            ? 'No sandboxes match your search.'
            : 'No sandboxes yet. Create one to let Function blocks import packages.'}
        </SettingsEmptyState>
      ) : (
        <div className={RESOURCE_LIST_STACK}>
          {filtered.map((sandbox) => (
            <SettingsResourceRow
              key={sandbox.id}
              icon={<CodeIcon className='text-[var(--text-icon)]' />}
              iconFilled
              title={sandbox.name}
              description={`${sandbox.language === 'python' ? 'Python' : 'JavaScript'} · ${sandbox.dependencies.length} ${sandbox.dependencies.length === 1 ? 'package' : 'packages'}`}
              onClick={() => void setSelectedId(sandbox.id)}
              clickLabel={`Open ${sandbox.name}`}
              navigable
            />
          ))}
        </div>
      )}
    </SettingsPanel>
  )
}
