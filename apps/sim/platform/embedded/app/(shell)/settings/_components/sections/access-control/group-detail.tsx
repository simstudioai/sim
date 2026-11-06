'use client'

import { useState } from 'react'
import type {
  PermissionGroup,
  PermissionGroupWorkspaceRef,
} from '@/ee/access-control/hooks/permission-groups'
import {
  applyPermissionAccess,
  createPermissionResolvers,
  isAgentDefaultUsable,
} from '@/ee/access-control/lib/editor'
import type {
  AccessRequestTarget,
  PermissionGroupAccessState,
} from '@/ee/access-requests/lib/targets'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'
import {
  Button,
  ConfirmDialog,
  SaveActions,
  SegmentedControl,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  DetailHeader,
  DraftConflictNotice,
  Muted,
  SectionStack,
} from '@/platform/embedded/app/(shell)/settings/_components/section-parts/section-parts'
import { GroupCatalogTab } from '@/platform/embedded/app/(shell)/settings/_components/sections/access-control/group-catalog-tabs'
import { GroupGeneralTab } from '@/platform/embedded/app/(shell)/settings/_components/sections/access-control/group-general-tab'
import type { PermissionControls } from '@/platform/embedded/app/(shell)/settings/_components/sections/access-control/permission-rows'
import { useGroupDraft } from '@/platform/embedded/app/(shell)/settings/_components/sections/access-control/use-group-draft'
import {
  useDeletePermissionGroup,
  useGroupDetailParams,
  usePermissionEditorModel,
} from '@/platform/embedded/lib/data/access-control'

const TABS = [
  { value: 'general', label: 'General' },
  { value: 'providers', label: 'Model Providers' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'platform', label: 'Platform' },
] as const

interface GroupDetailProps {
  group: PermissionGroup
  organizationId: string
  hosted: boolean
  workspaceOptions: { value: string; label: string }[]
  organizationWorkspaces: PermissionGroupWorkspaceRef[]
  workspacesLoading: boolean
  onBack: () => void
}

/**
 * One permission group. Every field on every tab joins one draft and one Save, members excepted:
 * adding or removing a person is a list action with its own dialog.
 */
export function GroupDetail({
  group,
  organizationId,
  hosted,
  workspaceOptions,
  organizationWorkspaces,
  workspacesLoading,
  onBack,
}: GroupDetailProps) {
  const deleteGroup = useDeletePermissionGroup()
  const params = useGroupDetailParams()
  const editor = usePermissionEditorModel(organizationId)
  const { model } = editor
  const groupDraft = useGroupDraft(group, organizationId)
  const { config, name, description, isDefault, workspaceIds } = groupDraft.draft
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const controls: PermissionControls | null = model
    ? {
        ...createPermissionResolvers(config, model.accessCatalog),
        onSet: (targets: AccessRequestTarget[], state: PermissionGroupAccessState) =>
          groupDraft.edit((current) => ({
            ...current,
            config: applyPermissionAccess(current.config, targets, state, model.accessCatalog),
          })),
      }
    : null
  const isAgentDefaultValid = model
    ? isAgentDefaultUsable(config, { hosted, providerIds: model.providerIds }, model.facts)
    : true

  const guard = useSettingsUnsavedGuard({
    isDirty: groupDraft.dirty,
    navigationBlocked: groupDraft.saving || deleteGroup.isPending,
    onDiscard: groupDraft.takeLatest,
  })

  return (
    <>
      <DetailHeader
        backLabel='Permission groups'
        onBack={() => guard.guardBack(onBack)}
        title={groupDraft.savedName}
        description={groupDraft.savedDescription || undefined}
      />
      <SegmentedControl
        label='Permission group settings'
        options={TABS}
        value={params.tab}
        onSelect={params.selectTab}
      />
      {params.tab !== 'general' && (
        <Muted>
          Allowed permits use. Can request requires admin approval. Unavailable blocks both.
          Workspace roles and deployment settings still apply.
        </Muted>
      )}
      {params.tab === 'general' ? (
        <SectionStack>
          <GroupGeneralTab
            group={group}
            organizationId={organizationId}
            name={name}
            description={description}
            isDefault={isDefault}
            workspaceIds={workspaceIds}
            workspaceOptions={workspaceOptions}
            organizationWorkspaces={organizationWorkspaces}
            workspacesLoading={workspacesLoading}
            onChange={groupDraft.patch}
          />
        </SectionStack>
      ) : (
        <GroupCatalogTab
          params={params}
          editor={editor}
          controls={controls}
          config={config}
          isDefault={isDefault}
          hosted={hosted}
          organizationId={organizationId}
          onConfigChange={groupDraft.patchConfig}
        />
      )}
      {groupDraft.conflict && (
        <DraftConflictNotice
          onKeepMine={groupDraft.keepMine}
          onTakeLatest={groupDraft.takeLatest}
        />
      )}
      <SaveActions
        dirty={groupDraft.dirty}
        saving={groupDraft.saving}
        blocked={groupDraft.conflict || !groupDraft.nameValid || !isAgentDefaultValid}
        onSave={() => void groupDraft.save()}
        onDiscard={groupDraft.takeLatest}
      />
      <SettingsSection title='Manage'>
        <SettingsRow label='Delete permission group'>
          <Button
            variant='destructive'
            disabled={deleteGroup.isPending}
            onClick={() => setConfirmingDelete(true)}
          >
            {deleteGroup.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </SettingsRow>
      </SettingsSection>
      <ConfirmDialog
        target={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title='Delete permission group'
        description={`Are you sure you want to delete ${groupDraft.savedName}? All members will be removed from this group. This action cannot be undone.`}
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={async () => {
          await deleteGroup.mutateAsync({ permissionGroupId: group.id, organizationId })
          onBack()
        }}
      />
    </>
  )
}
