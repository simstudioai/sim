'use client'

import { useState } from 'react'
import { ChipConfirmModal, ChipTag } from '@sim/emcn'
import { GridOffset, Plus } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import {
  credentialGroupIdParam,
  credentialGroupIdUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import type { SettingsAction } from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { CredentialGroupCreateModal } from '@/ee/credential-groups/components/credential-group-create-modal'
import { CredentialGroupDetail } from '@/ee/credential-groups/components/credential-group-detail'
import { useCredentialGroups, useDeleteCredentialGroup } from '@/hooks/queries/credential-groups'

interface CredentialGroupsSettingsProps {
  workspaceId: string
}

export function CredentialGroupsSettings({ workspaceId }: CredentialGroupsSettingsProps) {
  const { data: groups = [], isPending, error } = useCredentialGroups(workspaceId)
  const deleteGroup = useDeleteCredentialGroup()
  const [search, setSearch] = useSettingsSearch()
  const [showCreate, setShowCreate] = useState(false)
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useQueryState(credentialGroupIdParam.key, {
    ...credentialGroupIdParam.parser,
    ...credentialGroupIdUrlKeys,
  })
  const deletingGroup = groups.find((group) => group.id === deletingGroupId)
  const selectedGroup = selectedGroupId
    ? groups.find((group) => group.id === selectedGroupId)
    : undefined

  const query = search.trim().toLowerCase()
  const filtered = query
    ? groups.filter((group) =>
        [group.name, group.description ?? '', ...group.options.map((option) => option.label)].some(
          (value) => value.toLowerCase().includes(query)
        )
      )
    : groups

  const actions: SettingsAction[] = [
    {
      text: 'Create group',
      icon: Plus,
      variant: 'primary',
      onSelect: () => setShowCreate(true),
    },
  ]

  const handleDelete = async () => {
    if (!deletingGroupId) return
    try {
      await deleteGroup.mutateAsync({ workspaceId, groupId: deletingGroupId })
      setDeletingGroupId(null)
    } catch {
      return
    }
  }

  if (selectedGroup) {
    return (
      <CredentialGroupDetail
        workspaceId={workspaceId}
        groupId={selectedGroup.id}
        onBack={() => void setSelectedGroupId(null, { history: 'replace' })}
      />
    )
  }

  return (
    <>
      <SettingsPanel
        actions={actions}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search credential groups...',
          disabled: isPending,
        }}
      >
        {error ? (
          <SettingsEmptyState tone='error'>
            {getErrorMessage(error, "Couldn't load credential groups")}
          </SettingsEmptyState>
        ) : isPending ? null : groups.length === 0 ? (
          <SettingsEmptyState>Click "Create group" above to get started</SettingsEmptyState>
        ) : filtered.length === 0 ? (
          <SettingsEmptyState variant='inline'>No groups match "{search}"</SettingsEmptyState>
        ) : (
          <div className={RESOURCE_LIST_STACK}>
            {filtered.map((group) => {
              const optionCount = group.options.length
              return (
                <SettingsResourceRow
                  key={group.id}
                  icon={<GridOffset />}
                  title={group.name}
                  description={`${optionCount} account type${optionCount === 1 ? '' : 's'} · ${group.description || 'Managed workspace credentials'}`}
                  onClick={() => void setSelectedGroupId(group.id)}
                  clickLabel={`Open ${group.name}`}
                  navigable
                  badge={
                    group.status === 'disabled' ? (
                      <ChipTag variant='gray'>Disabled</ChipTag>
                    ) : undefined
                  }
                  trailing={
                    <RowActionsMenu
                      label={`${group.name} actions`}
                      actions={[
                        {
                          label: 'Delete',
                          destructive: true,
                          onSelect: () => setDeletingGroupId(group.id),
                        },
                      ]}
                    />
                  }
                />
              )
            })}
          </div>
        )}
      </SettingsPanel>
      <CredentialGroupCreateModal
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={(groupId) => void setSelectedGroupId(groupId)}
        workspaceId={workspaceId}
      />
      <ChipConfirmModal
        open={Boolean(deletingGroup)}
        onOpenChange={(open) => !open && !deleteGroup.isPending && setDeletingGroupId(null)}
        srTitle='Delete credential group'
        title='Delete credential group'
        text={[
          `Delete ${deletingGroup?.name ?? 'this credential group'}?`,
          { text: ' This cannot be undone.', error: true },
        ]}
        dismissLabel='Cancel'
        confirm={{
          label: deleteGroup.isPending ? 'Deleting...' : 'Delete',
          onClick: handleDelete,
          disabled: deleteGroup.isPending,
        }}
      />
    </>
  )
}
