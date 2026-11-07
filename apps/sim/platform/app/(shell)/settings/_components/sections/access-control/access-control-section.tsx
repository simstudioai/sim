'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { Checkbox } from '@sim/emcn/checkbox'
import { EmptyState } from '@sim/emcn/empty-state'
import { TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  ResourceList,
  SectionStack,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { GroupDetail } from '@/platform/app/(shell)/settings/_components/sections/access-control/group-detail'
import {
  type PermissionGroup,
  useAccessControlParams,
  useCreatePermissionGroup,
  useOrganizationWorkspaces,
  usePermissionGroups,
} from '@/platform/lib/data/access-control'
import { platformHref } from '@/platform/lib/navigation'
import { plural } from '@/platform/shared/plural'

function groupSummary(group: PermissionGroup): string {
  if (group.isDefault) return 'Everyone in the organization'
  const members = group.memberCount === 0 ? 'All members' : plural(group.memberCount, 'member')
  return `${members} · ${plural(group.workspaces.length, 'workspace')}`
}

interface CreateGroupModalProps {
  organizationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceOptions: { value: string; label: string }[]
  workspacesLoading: boolean
}

function CreateGroupModal({
  organizationId,
  open,
  onOpenChange,
  workspaceOptions,
  workspacesLoading,
}: CreateGroupModalProps) {
  const createGroup = useCreatePermissionGroup()
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
      confirmLabel={createGroup.isPending ? 'Creating…' : 'Create'}
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
        hint={
          isDefault
            ? undefined
            : "Applies to all members of the selected workspaces. Restrict to specific people later from the group's Members section."
        }
        options={workspaceOptions}
        value={workspaceIds}
        onValueChange={setWorkspaceIds}
        disabled={isDefault || workspacesLoading}
      />
    </Modal>
  )
}

export default function AccessControlSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  const groups = usePermissionGroups(organizationId)
  const workspaces = useOrganizationWorkspaces(organizationId)
  const params = useAccessControlParams()
  const searchParams = useSearchParams()
  const [creating, setCreating] = useState(false)
  const permissionGroups = groups.data ?? []
  const organizationWorkspaces = workspaces.data ?? []
  const workspaceOptions = organizationWorkspaces.map((ws) => ({ value: ws.id, label: ws.name }))
  const query = params.search.trim().toLowerCase()
  const filtered = query
    ? permissionGroups.filter((group) => group.name.toLowerCase().includes(query))
    : permissionGroups
  const selectedGroup = params.groupId
    ? permissionGroups.find((group) => group.id === params.groupId)
    : undefined

  if (groups.isPending) return null
  if (groups.error && groups.data === undefined) {
    return (
      <FailureNotice
        message={getErrorMessage(groups.error, 'Failed to load permission groups')}
        retrying={groups.isFetching}
        onRetry={() => void groups.refetch()}
      />
    )
  }

  const workspacesError = workspaces.error && workspaces.data === undefined && (
    <FailureNotice
      message={getErrorMessage(workspaces.error, 'Failed to load workspaces')}
      retrying={workspaces.isFetching}
      onRetry={() => void workspaces.refetch()}
    />
  )

  const refreshError = groups.error && (
    <FailureNotice
      message={getErrorMessage(groups.error, 'Failed to refresh permission groups')}
      retrying={groups.isFetching}
      onRetry={() => void groups.refetch()}
    />
  )

  if (selectedGroup) {
    return (
      <SectionStack>
        {refreshError}
        {workspacesError}
        <GroupDetail
          key={selectedGroup.id}
          group={selectedGroup}
          organizationId={organizationId}
          hosted={organization.deployment.hosted}
          projectsEnabled={organization.featureFlags.projects}
          workspaceOptions={workspaceOptions}
          organizationWorkspaces={organizationWorkspaces}
          workspacesLoading={workspaces.isPending}
          onBack={params.closeGroup}
        />
      </SectionStack>
    )
  }

  return (
    <SectionStack>
      {refreshError}
      {workspacesError}
      <SearchField
        label='Search permission groups'
        placeholder='Search permission groups…'
        value={params.search}
        onValueChange={params.setSearch}
      />
      {permissionGroups.length === 0 ? (
        <EmptyState title='No permission groups yet' description='Create a group to get started.' />
      ) : filtered.length === 0 ? (
        <EmptyState title={`No groups found matching "${params.search}"`} />
      ) : (
        <SettingsSection title={`Permission groups ${permissionGroups.length}`}>
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
        </SettingsSection>
      )}
      <SettingsSection title='Manage'>
        <SettingsRow label='New permission group'>
          <Button size='compact' icon='I074' onClick={() => setCreating(true)}>
            Create group
          </Button>
        </SettingsRow>
        <SettingsRow label='Access requests'>
          <Button
            size='compact'
            render={<Link href={platformHref('/settings/requests', searchParams)} />}
          >
            Review requests
          </Button>
        </SettingsRow>
      </SettingsSection>
      <CreateGroupModal
        organizationId={organizationId}
        open={creating}
        onOpenChange={setCreating}
        workspaceOptions={workspaceOptions}
        workspacesLoading={workspaces.isPending}
      />
    </SectionStack>
  )
}
