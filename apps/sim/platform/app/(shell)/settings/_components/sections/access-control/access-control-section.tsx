'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { getOrganizationSettingsHref } from '@/components/settings/navigation'
import {
  LoadingState,
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
  FailureNotice,
  Modal,
  MultiSelect,
  SearchField,
  TextField,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  type PermissionGroup,
  useAccessControlParams,
  useCreatePermissionGroup,
  useOrganizationWorkspaces,
  usePermissionEditorCatalog,
  usePermissionGroups,
} from '@/platform/lib/data/access-control'
import { useProjectsEnabled } from '@/platform/lib/data/organization'
import { plural } from '@/platform/lib/plural'

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
  const projectsEnabled = useProjectsEnabled()
  usePermissionEditorCatalog(organizationId)
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
          projectsEnabled={projectsEnabled}
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
      <SectionToolbar
        grow={
          <SearchField
            label='Search permission groups'
            placeholder='Search permission groups…'
            value={params.search}
            onValueChange={params.setSearch}
          />
        }
      >
        <Button variant='primary' size='compact' icon='I074' onClick={() => setCreating(true)}>
          Create group
        </Button>
      </SectionToolbar>
      {permissionGroups.length === 0 ? (
        <EmptyState title='No permission groups yet' />
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
                metadata={group.isDefault ? 'Default' : undefined}
                onOpen={() => params.openGroup(group.id)}
              />
            ))}
          </ResourceList>
        </SettingsSection>
      )}
      <SettingsSection title='Manage'>
        <SettingsRow label='Access requests'>
          <Button
            size='compact'
            render={<Link href={getOrganizationSettingsHref(organizationId, 'requests')} />}
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
