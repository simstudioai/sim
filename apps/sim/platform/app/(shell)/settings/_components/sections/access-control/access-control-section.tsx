'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import {
  LoadingState,
  QueryErrorState,
  ResourceList,
  SectionStack,
  SectionToolbar,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { GroupDetail } from '@/platform/app/(shell)/settings/_components/sections/access-control/group-detail'
import {
  ActivityRow,
  Button,
  Checkbox,
  EmptyState,
  Modal,
  MultiSelect,
  SearchField,
  TextField,
} from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'
import {
  type PermissionGroup,
  useAccessControlParams,
  useCreatePermissionGroup,
  useOrganizationWorkspaces,
  usePermissionGroups,
} from '@/platform/lib/data/access-control'

function groupSummary(group: PermissionGroup): string {
  if (group.isDefault) return 'Everyone in the organization'
  const members =
    group.memberCount === 0
      ? 'All members'
      : `${group.memberCount} member${group.memberCount === 1 ? '' : 's'}`
  return `${members} · ${group.workspaces.length} workspace${group.workspaces.length === 1 ? '' : 's'}`
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
      title='Create Permission Group'
      confirmLabel={createGroup.isPending ? 'Creating…' : 'Create'}
      confirmDisabled={
        !name.trim() || createGroup.isPending || (!isDefault && workspaceIds.length === 0)
      }
      onConfirm={async () => {
        await createGroup.mutateAsync({
          organizationId,
          name: name.trim(),
          description: description.trim() || undefined,
          isDefault,
          workspaceIds: isDefault ? undefined : workspaceIds,
        })
        change(false)
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
        placeholder={
          workspacesLoading
            ? 'Loading workspaces…'
            : isDefault
              ? 'All workspaces'
              : 'Select workspaces…'
        }
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

  if (groups.isPending) return <LoadingState label='Loading permission groups…' />
  if (groups.error && groups.data === undefined) {
    return (
      <QueryErrorState
        message={getErrorMessage(groups.error, 'Failed to load permission groups')}
        retrying={groups.isFetching}
        onRetry={() => void groups.refetch()}
      />
    )
  }

  const refreshError = groups.error && (
    <QueryErrorState
      message={getErrorMessage(groups.error, 'Failed to refresh permission groups')}
      retrying={groups.isFetching}
      onRetry={() => void groups.refetch()}
    />
  )

  if (selectedGroup) {
    return (
      <SectionStack>
        {refreshError}
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
      <SectionToolbar
        grow={
          <SearchField
            label='Search permission groups'
            placeholder='Search permission groups...'
            defaultValue={params.search}
            onValueChange={params.setSearch}
          />
        }
      >
        <Button variant='quiet' render={<Link href='/settings/requests' />}>
          Review requests
        </Button>
        <Button variant='primary' icon='I074' onClick={() => setCreating(true)}>
          Create group
        </Button>
      </SectionToolbar>
      {permissionGroups.length === 0 ? (
        <EmptyState title='No permission groups yet. Click "Create group" to get started.' />
      ) : filtered.length === 0 ? (
        <EmptyState title={`No groups found matching "${params.search}"`} />
      ) : (
        <SettingsSection title={`Permission groups (${permissionGroups.length})`}>
          <ResourceList>
            {filtered.map((group) => (
              <ActivityRow
                key={group.id}
                title={group.name}
                detail={groupSummary(group)}
                metadata={group.isDefault ? 'Default' : undefined}
                onOpen={() => params.openGroup(group.id)}
              />
            ))}
          </ResourceList>
        </SettingsSection>
      )}
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
