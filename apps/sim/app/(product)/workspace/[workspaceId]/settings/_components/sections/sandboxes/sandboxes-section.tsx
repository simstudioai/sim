'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  ResourceList,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import { SandboxEditor } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/sandboxes/sandbox-editor'
import { UpgradeNotice } from '@/app/(product)/workspace/[workspaceId]/settings/_components/upgrade-notice/upgrade-notice'
import {
  canRetrySandboxBuild,
  draftFromSandbox,
  emptyDraft,
  extractIssues,
  SANDBOX_UPGRADE_DESCRIPTION,
  SANDBOX_UPGRADE_TITLE,
  type SandboxDependencyIssue,
  type SandboxDraft,
  toSubmittedLines,
  useCreateSandbox,
  useDeleteSandbox,
  useSandboxes,
  useSandboxParam,
  useSettingsSearch,
  useUpdateSandbox,
} from '@/platform/lib/data/sandboxes'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'
import { plural } from '@/platform/shared/plural'

const LANGUAGE_LABEL = { python: 'Python', javascript: 'JavaScript' } as const

/** The workspace's Function-block sandboxes: package lists, managed CLI tools and their builds. */
export default function SandboxesSection({ workspaceId }: WorkspaceSettingsSectionProps) {
  const {
    canMutate: canAdmin,
    locked,
    permission,
  } = useWorkspaceSettingsSection(workspaceId, 'sandboxes')
  const [search, setSearch] = useSettingsSearch()
  const [selectedId, setSelectedId] = useSandboxParam()

  const { data, isPending, error, isFetching, refetch } = useSandboxes(workspaceId)
  const createSandbox = useCreateSandbox()
  const updateSandbox = useUpdateSandbox()
  const deleteSandbox = useDeleteSandbox()

  const [draft, setDraft] = useState<SandboxDraft | null>(null)
  const [dependencyIssues, setDependencyIssues] = useState<SandboxDependencyIssue[]>([])
  const [systemPackageIssues, setSystemPackageIssues] = useState<SandboxDependencyIssue[]>([])
  const [isCreating, setIsCreating] = useState(false)

  // The draft belongs to whatever was open when it was typed. Browser Back clears the id without
  // closing the editor, so the next sandbox opened would otherwise render and save these edits.
  const [draftOwnerId, setDraftOwnerId] = useState<string | null>(null)
  if (draftOwnerId !== selectedId) {
    setDraftOwnerId(selectedId)
    if (draft) {
      setDraft(null)
      setDependencyIssues([])
      setSystemPackageIssues([])
    }
    // History can land on a sandbox while create mode is still set (Forward after starting one).
    if (selectedId) setIsCreating(false)
  }

  const sandboxes = data?.sandboxes ?? []
  const selected = selectedId
    ? (sandboxes.find((sandbox) => sandbox.id === selectedId) ?? null)
    : null
  const baseline = isCreating ? null : selected
  const original = baseline ? draftFromSandbox(baseline) : emptyDraft()
  const current = draft ?? original
  const isEditing = isCreating || Boolean(selected)
  const isDirty =
    isEditing &&
    (isCreating
      ? current.name.trim().length > 0 ||
        current.language !== original.language ||
        current.dependencies.trim().length > 0 ||
        current.systemPackages.trim().length > 0 ||
        current.cliTools.length > 0
      : current.name !== original.name ||
        current.language !== original.language ||
        current.dependencies !== original.dependencies ||
        current.systemPackages !== original.systemPackages ||
        current.cliTools.join(',') !== original.cliTools.join(','))
  const saving = createSandbox.isPending || updateSandbox.isPending

  function discardDraft() {
    setDraft(null)
    setDependencyIssues([])
    setSystemPackageIssues([])
  }

  const guard = useSettingsUnsavedGuard({
    isDirty,
    navigationBlocked: saving || deleteSandbox.isPending,
    onDiscard: discardDraft,
  })

  function closeEditor() {
    discardDraft()
    setIsCreating(false)
    // Opening pushed a history entry; closing must not push another.
    void setSelectedId(null, { history: 'replace' })
  }

  async function handleSave() {
    setDependencyIssues([])
    setSystemPackageIssues([])
    const body = {
      name: current.name.trim(),
      language: current.language,
      dependencies: toSubmittedLines(current.dependencies),
      systemPackages: toSubmittedLines(current.systemPackages),
      cliTools: current.cliTools,
    }
    try {
      if (isCreating) await createSandbox.mutateAsync({ workspaceId, ...body })
      else if (selected)
        await updateSandbox.mutateAsync({ workspaceId, sandboxId: selected.id, ...body })
      closeEditor()
    } catch (caught) {
      const lineIssues = extractIssues(caught)
      if (lineIssues) {
        setDependencyIssues(lineIssues.field === 'dependencies' ? lineIssues.issues : [])
        setSystemPackageIssues(lineIssues.field === 'systemPackages' ? lineIssues.issues : [])
        return
      }
      toast.error(getErrorMessage(caught, 'Failed to save sandbox'))
    }
  }

  async function handleRetry() {
    if (!selected || !canRetrySandboxBuild({ canAdmin, isDirty, saving })) return
    try {
      await updateSandbox.mutateAsync({
        workspaceId,
        sandboxId: selected.id,
        language: selected.language,
        dependencies: selected.dependencies,
        systemPackages: selected.systemPackages,
        cliTools: selected.cliTools,
      })
      toast.success('Sandbox build queued')
    } catch (caught) {
      toast.error(getErrorMessage(caught, 'Failed to retry sandbox build'))
    }
  }

  if (isPending) return selectedId === null ? <SettingsPageHeader /> : null

  if (data === undefined)
    return (
      <>
        <SettingsPageHeader />
        <FailureNotice
          message={getErrorMessage(error, 'Failed to load sandboxes')}
          retrying={isFetching}
          onRetry={() => void refetch()}
        />
      </>
    )

  if (locked || !data.entitled)
    return (
      <>
        <SettingsPageHeader />
        <UpgradeNotice
          title={SANDBOX_UPGRADE_TITLE}
          description={SANDBOX_UPGRADE_DESCRIPTION}
          canUpgrade={permission === 'admin'}
        />
      </>
    )

  if (isEditing)
    return (
      <SandboxEditor
        key={selected?.id ?? 'new'}
        sandbox={selected}
        strategy={data.strategy}
        draft={current}
        onChange={setDraft}
        dependencyIssues={dependencyIssues}
        systemPackageIssues={systemPackageIssues}
        canAdmin={canAdmin}
        dirty={isDirty}
        saving={saving}
        deleting={deleteSandbox.isPending}
        retrying={updateSandbox.isPending}
        canRetry={canRetrySandboxBuild({ canAdmin, isDirty, saving })}
        onBack={() => guard.guardBack(closeEditor)}
        onSave={() => void handleSave()}
        onDiscard={discardDraft}
        onRetry={() => void handleRetry()}
        onDelete={async () => {
          if (!selected) return
          await deleteSandbox.mutateAsync({ workspaceId, sandboxId: selected.id })
          closeEditor()
        }}
      />
    )

  const query = search.trim().toLowerCase()
  const filtered = query
    ? sandboxes.filter(
        (sandbox) =>
          sandbox.name.toLowerCase().includes(query) ||
          sandbox.dependencies.some((dependency) => dependency.toLowerCase().includes(query)) ||
          sandbox.systemPackages.some((systemPackage) =>
            systemPackage.toLowerCase().includes(query)
          ) ||
          sandbox.cliTools.some((cliTool) => cliTool.toLowerCase().includes(query))
      )
    : sandboxes

  return (
    <SectionStack>
      <SettingsPageHeader />
      <SectionToolbar
        grow={
          <SearchField
            label='Search sandboxes'
            placeholder='Search sandboxes…'
            value={search}
            onValueChange={setSearch}
          />
        }
      />
      <SettingsSection title='Sandboxes'>
        {filtered.length > 0 ? (
          <ResourceList>
            {filtered.map((sandbox) => {
              const dependencies = sandbox.dependencies.length
              return (
                <ActivityRow
                  key={sandbox.id}
                  leading={<Icon name='I107' />}
                  title={sandbox.name}
                  detail={[
                    LANGUAGE_LABEL[sandbox.language],
                    `${dependencies} ${dependencies === 1 ? 'dependency' : 'dependencies'}`,
                    plural(sandbox.systemPackages.length, 'system package'),
                    plural(sandbox.cliTools.length, 'managed CLI'),
                  ].join(' · ')}
                  onOpen={() => void setSelectedId(sandbox.id)}
                />
              )
            })}
          </ResourceList>
        ) : query ? (
          <EmptyState title='No sandboxes match your search.' />
        ) : (
          <EmptyState
            title='No sandboxes yet'
            description='Create one to add dependencies, system packages, and managed CLI tools to Function blocks.'
          />
        )}
        {canAdmin && (
          <SettingsRow
            label='New sandbox'
            description='Choose the packages and tools your Function blocks can use'
          >
            <Button
              size='compact'
              icon='I074'
              onClick={() => {
                setDraft(emptyDraft())
                setIsCreating(true)
                // Starting a new one is a mode switch, not a destination: replace rather than push.
                void setSelectedId(null, { history: 'replace' })
              }}
            >
              New sandbox
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>
    </SectionStack>
  )
}
