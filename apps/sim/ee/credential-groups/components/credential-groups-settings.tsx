'use client'

import { useState } from 'react'
import { ChipTag } from '@sim/emcn'
import { GridOffset, Plus } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import {
  credentialGroupIdParam,
  credentialGroupIdUrlKeys,
  credentialGroupProviderSearchParam,
  credentialGroupProviderSearchUrlKeys,
  credentialGroupTabParam,
  credentialGroupTabUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
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
import { useCredentialGroups } from '@/hooks/queries/credential-groups'

interface CredentialGroupsSettingsProps {
  workspaceId: string
}

export function CredentialGroupsSettings({ workspaceId }: CredentialGroupsSettingsProps) {
  const { data, isPending, error } = useCredentialGroups(workspaceId)
  const groups = data?.credentialGroups ?? []
  const availableProviders = data?.availableProviders ?? []
  const [search, setSearch] = useSettingsSearch()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useQueryState(credentialGroupIdParam.key, {
    ...credentialGroupIdParam.parser,
    ...credentialGroupIdUrlKeys,
  })
  /**
   * The detail view's tab is scoped to one group, so both transitions reset it —
   * otherwise a `credential-group-id` that never resolves leaves
   * `credential-group-tab` behind and the next group opens on the previous
   * group's tab. nuqs batches these same-tick writes into one URL update.
   */
  const [, setSelectedTab] = useQueryState(credentialGroupTabParam.key, {
    ...credentialGroupTabParam.parser,
    ...credentialGroupTabUrlKeys,
  })
  /** Scoped to one group's account types for the same reason, and reset on the same transitions. */
  const [, setProviderSearch] = useQueryState(credentialGroupProviderSearchParam.key, {
    ...credentialGroupProviderSearchParam.parser,
    ...credentialGroupProviderSearchUrlKeys,
  })
  const openGroup = (groupId: string) => {
    void setSelectedGroupId(groupId)
    void setSelectedTab(null)
    void setProviderSearch(null)
  }
  const closeGroup = () => {
    void setSelectedGroupId(null, { history: 'replace' })
    void setSelectedTab(null)
    void setProviderSearch(null)
  }
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

  /**
   * Hold the first paint while a deep-linked id could still resolve, so a valid
   * link never flashes the list before jumping to it. A dead id still falls back
   * to the list.
   */
  if (selectedGroupId !== null && isPending) return null

  if (selectedGroup) {
    return (
      <CredentialGroupDetail
        key={selectedGroup.id}
        workspaceId={workspaceId}
        groupId={selectedGroup.id}
        onBack={closeGroup}
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
          <SettingsEmptyState variant='inline'>
            No credential groups found matching "{search}"
          </SettingsEmptyState>
        ) : (
          <div className={RESOURCE_LIST_STACK}>
            {filtered.map((group) => {
              const optionCount = group.options.length
              const accountTypes = `${optionCount} account type${optionCount === 1 ? '' : 's'}`
              return (
                <SettingsResourceRow
                  key={group.id}
                  icon={<GridOffset className='text-[var(--text-icon)]' />}
                  iconFilled
                  title={group.name}
                  description={
                    group.description ? `${accountTypes} · ${group.description}` : accountTypes
                  }
                  onClick={() => openGroup(group.id)}
                  clickLabel={`Open ${group.name}`}
                  navigable
                  badge={
                    group.status === 'disabled' ? (
                      <ChipTag variant='gray'>Disabled</ChipTag>
                    ) : undefined
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
        onCreated={openGroup}
        workspaceId={workspaceId}
      />
    </>
  )
}
