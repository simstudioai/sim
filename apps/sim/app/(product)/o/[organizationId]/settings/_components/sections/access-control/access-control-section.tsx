'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { Checkbox } from '@sim/emcn/checkbox'
import { TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow } from '@sim/emcn/settings-section'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  ResourceList,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import {
  GroupDetail,
  groupSummary,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/access-control/group-detail'
import {
  useAccessControlParams,
  useCreatePermissionGroup,
  useOrganizationWorkspaces,
  usePermissionGroups,
} from '@/platform/lib/data/access-control'

interface CreateGroupModalProps {
  organizationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function CreateGroupModal({ organizationId, open, onOpenChange }: CreateGroupModalProps) {
  const createGroup = useCreatePermissionGroup()
  const workspaces = useOrganizationWorkspaces(organizationId, open)
  const workspaceOptions = (workspaces.data ?? []).map((workspace) => ({
    value: workspace.id,
    label: workspace.name,
  }))
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([])

  function change(next: boolean) {
    if (!next) {
      setName('')
      setDescription('')
      setIsDefault(false)
      setWorkspaceIds([])
    }
    onOpenChange(next)
  }

  return (
    <Modal
      open={open}
      onOpenChange={change}
      title='Create permission group'
      description='Give the group a name and choose the workspaces it governs'
      confirmLabel={createGroup.isPending ? 'Creating…' : 'Create group'}
      confirmDisabled={!name.trim() || (!isDefault && workspaceIds.length === 0)}
      onConfirm={async () => {
        await createGroup.mutateAsync({
          organizationId,
          name: name.trim(),
          description: description.trim() || undefined,
          isDefault,
          workspaceIds: isDefault ? undefined : workspaceIds,
        })
      }}
    >
      <TextField label='Name' placeholder='e.g., Marketing Team' value={name} onChange={setName} />
      <TextField
        label='Description'
        optional
        placeholder='e.g., Limited access for marketing users'
        value={description}
        onChange={setDescription}
      />
      <Checkbox
        label='Make this the organization default group'
        checked={isDefault}
        onCheckedChange={(checked) => {
          setIsDefault(checked)
          if (checked) setWorkspaceIds([])
        }}
      />
      <MultiSelect
        label='Workspaces'
        searchLabel='Search workspaces…'
        placeholder={isDefault ? 'All workspaces' : 'Select workspaces…'}
        options={workspaceOptions}
        value={workspaceIds}
        onValueChange={setWorkspaceIds}
        disabled={isDefault || workspaces.data === undefined}
      />
    </Modal>
  )
}

export default function AccessControlSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  const groups = usePermissionGroups(organizationId)
  const params = useAccessControlParams()
  const [creating, setCreating] = useState(false)
  const permissionGroups = groups.data ?? []
  const query = params.search.trim().toLowerCase()
  const filtered = query
    ? permissionGroups.filter((group) => group.name.toLowerCase().includes(query))
    : permissionGroups
  const selectedGroup = params.groupId
    ? permissionGroups.find((group) => group.id === params.groupId)
    : undefined

  /** A valid deep link never flashes the list before jumping to it; a dead id falls back to it. */
  if (params.groupId && groups.isPending) return null

  if (selectedGroup) {
    return (
      <GroupDetail
        key={selectedGroup.id}
        group={selectedGroup}
        organizationId={organizationId}
        hosted={organization.deployment.hosted}
        projectsEnabled={organization.featureFlags.projects}
        onBack={params.closeGroup}
      />
    )
  }

  const createGroup = (
    <Button size='compact' icon='I074' onClick={() => setCreating(true)}>
      Create group
    </Button>
  )

  return (
    <SectionStack>
      <SettingsPageHeader />
      {permissionGroups.length > 0 && (
        <SectionToolbar
          grow={
            <SearchField
              label='Search permission groups'
              placeholder='Search permission groups…'
              value={params.search}
              onValueChange={params.setSearch}
            />
          }
        />
      )}
      <SettingsRead query={groups} failureMessage='Failed to load permission groups'>
        {(list) => (
          <SettingsList
            title='Permission groups'
            empty={
              list.length === 0
                ? {
                    title: 'No permission groups yet',
                    description: 'Limit what a set of members can use',
                    action: createGroup,
                  }
                : filtered.length === 0
                  ? { title: 'No matching groups' }
                  : undefined
            }
          >
            <ResourceList>
              {filtered.map((group) => (
                <ActivityRow
                  key={group.id}
                  title={group.name}
                  detail={groupSummary(group)}
                  textMetadata={group.isDefault ? 'Default' : undefined}
                  onOpen={() => params.openGroup(group.id)}
                />
              ))}
            </ResourceList>
            <SettingsRow
              label='New permission group'
              description='Limit what a set of members can use'
            >
              {createGroup}
            </SettingsRow>
          </SettingsList>
        )}
      </SettingsRead>
      <CreateGroupModal
        organizationId={organizationId}
        open={creating}
        onOpenChange={setCreating}
      />
    </SectionStack>
  )
}
