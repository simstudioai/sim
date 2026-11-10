'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Modal } from '@sim/emcn/modal'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { parseAsString, useQueryState } from 'nuqs'
import { FieldStack, SectionStack } from '@/app/(product)/_components/settings-parts/settings-parts'
import type {
  CredentialGroupActions,
  WorkspaceGrant,
} from '@/platform/lib/data/credential-group-actions'
import type { CredentialGroupsData } from '@/platform/lib/data/models/connected-accounts'

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
  const [removing, setRemoving] = useState(false)
  const available = data.workspaces.filter(
    (workspace) => !data.grants.some((grant) => grant.workspaceId === workspace.id)
  )
  const visible = data.workspaces.filter(
    (workspace) =>
      workspace.name.toLowerCase().includes(search.trim().toLowerCase()) &&
      data.grants.some((grant) => grant.workspaceId === workspace.id)
  )
  const existing = editing && data.grants.some((grant) => grant.workspaceId === editing.workspaceId)
  return (
    <SectionStack>
      <SearchField
        label='Search workspaces'
        value={search}
        onValueChange={(value) => void setSearch(value)}
      />
      <SettingsSection title='Workspaces'>
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
              <Button size='compact' onClick={() => setEditing(grant)}>
                Edit access
              </Button>
            </SettingsRow>
          )
        })}
        {!visible.length && (
          <EmptyState
            title={search.trim() ? 'No workspaces match your search' : 'No workspaces have access'}
          />
        )}
        <SettingsRow label='Grant workspace access'>
          <Button
            size='compact'
            disabled={!available.length || data.grants.length >= 1000}
            onClick={() => setEditing({ workspaceId: '', types: [] })}
          >
            Add workspace
          </Button>
        </SettingsRow>
      </SettingsSection>
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
          pending={removing}
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
            {existing && (
              <Button
                variant='destructive'
                disabled={removing}
                onClick={() => {
                  setRemoving(true)
                  actions
                    .saveGrants(
                      data.grants.filter((grant) => grant.workspaceId !== editing.workspaceId)
                    )
                    .then(
                      () => setEditing(undefined),
                      () => {}
                    )
                    .finally(() => setRemoving(false))
                }}
              >
                Remove access
              </Button>
            )}
          </FieldStack>
        </Modal>
      )}
    </SectionStack>
  )
}
