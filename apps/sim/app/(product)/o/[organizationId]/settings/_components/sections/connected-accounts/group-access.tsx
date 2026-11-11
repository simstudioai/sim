'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSurface } from '@sim/emcn/settings-section'
import { parseAsString, useQueryState } from 'nuqs'
import {
  ActionRow,
  FieldStack,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import type {
  CredentialGroupActions,
  WorkspaceGrant,
} from '@/platform/lib/data/credential-group-actions'
import {
  type CredentialGroupsData,
  MAX_WORKSPACE_GRANTS,
} from '@/platform/lib/data/models/connected-accounts'
import { LOCALE } from '@/platform/shared/time'

interface GroupAccessProps {
  data: CredentialGroupsData
  actions: CredentialGroupActions
}

export function GroupAccess({ data, actions }: GroupAccessProps) {
  const [search, setSearch] = useQueryState(
    'credential-group-workspace',
    parseAsString.withDefault('')
  )
  const [editing, setEditing] = useState<WorkspaceGrant>()
  const [removing, setRemoving] = useState<{ workspaceId: string; name: string }>()
  const available = data.workspaces.filter(
    (workspace) => !data.grants.some((grant) => grant.workspaceId === workspace.id)
  )
  const visible = data.workspaces.filter(
    (workspace) =>
      workspace.name.toLowerCase().includes(search.trim().toLowerCase()) &&
      data.grants.some((grant) => grant.workspaceId === workspace.id)
  )
  const searching = search.trim().length > 0
  const existing = editing && data.grants.some((grant) => grant.workspaceId === editing.workspaceId)
  const atLimit = data.grants.length >= MAX_WORKSPACE_GRANTS
  const addWorkspace = (
    <Button
      size='compact'
      disabled={!available.length || atLimit}
      disabledReason={
        atLimit
          ? `Access is limited to ${MAX_WORKSPACE_GRANTS.toLocaleString(LOCALE)} workspaces`
          : 'Every workspace already has access'
      }
      onClick={() => setEditing({ workspaceId: '', types: [] })}
    >
      Add workspace
    </Button>
  )
  return (
    <SectionStack>
      {data.grants.length > 0 && (
        <SearchField
          label='Search workspaces'
          placeholder='Search workspaces…'
          value={search}
          onValueChange={(value) => void setSearch(value)}
        />
      )}
      {visible.length === 0 ? (
        searching && data.grants.length > 0 ? (
          <EmptyState title='No matching workspaces' />
        ) : (
          <EmptyState
            title='No workspaces have access'
            description='Let a workspace use accounts from this pool'
            action={addWorkspace}
          />
        )
      ) : (
        <SettingsSurface>
          {visible.map((workspace) => {
            const grant = data.grants.find((item) => item.workspaceId === workspace.id)
            if (!grant) return null
            const description =
              grant.types === 'all'
                ? 'All integrations'
                : grant.types
                    .map(
                      (type) =>
                        data.credentialTypes.find((item) => item.value === type)?.label ?? type
                    )
                    .sort()
                    .join(', ')
            return (
              <SettingsRow key={workspace.id} label={workspace.name} description={description}>
                <ActionRow>
                  <Button size='compact' onClick={() => setEditing(grant)}>
                    Edit access
                  </Button>
                  <ActionMenu
                    icon='I108'
                    label={`${workspace.name} actions`}
                    actions={[
                      {
                        id: 'remove',
                        label: 'Remove',
                        destructive: true,
                        onSelect: () =>
                          setRemoving({ workspaceId: workspace.id, name: workspace.name }),
                      },
                    ]}
                  />
                </ActionRow>
              </SettingsRow>
            )
          })}
          <SettingsRow
            label='Grant workspace access'
            description='Let a workspace use accounts from this pool'
          >
            {addWorkspace}
          </SettingsRow>
        </SettingsSurface>
      )}
      {editing && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setEditing(undefined)
          }}
          title={
            existing
              ? `Edit ${data.workspaces.find((item) => item.id === editing.workspaceId)?.name} access`
              : 'Add workspace'
          }
          confirmLabel={existing ? 'Save access' : 'Add workspace'}
          confirmDisabled={!editing.workspaceId || !editing.types.length}
          onConfirm={() =>
            actions.saveGrants(
              existing
                ? data.grants.map((item) =>
                    item.workspaceId === editing.workspaceId ? editing : item
                  )
                : [...data.grants, editing]
            )
          }
        >
          <FieldStack>
            {!existing && (
              <SearchableSelect
                label='Workspace'
                searchLabel='Search workspaces'
                placeholder='Select workspace'
                options={available.map((item) => ({ value: item.id, label: item.name }))}
                value={editing.workspaceId || null}
                onValueChange={(value) => setEditing({ ...editing, workspaceId: value ?? '' })}
              />
            )}
            <MultiSelect
              label='Integrations'
              searchLabel='Search integrations'
              placeholder='Select integrations'
              options={[
                { value: 'all', label: 'All integrations, including future ones' },
                ...data.credentialTypes,
              ]}
              value={editing.types === 'all' ? ['all'] : editing.types}
              onValueChange={(values) =>
                setEditing({
                  ...editing,
                  types:
                    editing.types !== 'all' && values.includes('all')
                      ? 'all'
                      : values.filter((value) => value !== 'all'),
                })
              }
            />
          </FieldStack>
        </Modal>
      )}
      <ConfirmDialog
        target={removing}
        onClose={() => setRemoving(undefined)}
        title={({ name }) => `Remove ${name}`}
        description='The workspace can no longer use accounts from this pool.'
        confirmLabel='Remove'
        pendingLabel='Removing…'
        onConfirm={({ workspaceId }) =>
          actions.saveGrants(data.grants.filter((grant) => grant.workspaceId !== workspaceId))
        }
      />
    </SectionStack>
  )
}
