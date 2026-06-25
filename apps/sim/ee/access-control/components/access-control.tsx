'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ArrowRight, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Checkbox,
  Chip,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipTag,
  Label,
  Search,
} from '@/components/emcn'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { GroupDetail } from '@/ee/access-control/components/group-detail'
import { WorkspaceSelect } from '@/ee/access-control/components/workspace-select'
import {
  useCreatePermissionGroup,
  useOrganizationWorkspaces,
  usePermissionGroups,
  useUserPermissionConfig,
} from '@/ee/access-control/hooks/permission-groups'

const logger = createLogger('AccessControl')

export function AccessControl() {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : undefined

  /**
   * Access control is governed by the workspace's OWNING organization, which may
   * differ from the caller's active org (e.g. external members). Resolve the org
   * id and the caller's admin status server-side from the workspace so gating is
   * never keyed off the session's active org.
   */
  const { data: userPermissionConfig, isPending: entitlementLoading } =
    useUserPermissionConfig(workspaceId)
  const organizationId = userPermissionConfig?.organizationId ?? undefined
  const currentUserIsOrgAdmin = userPermissionConfig?.isOrgAdmin ?? false

  const { data: permissionGroups = [], isPending: groupsLoading } = usePermissionGroups(
    organizationId,
    !!organizationId && currentUserIsOrgAdmin
  )
  const { data: organizationWorkspaces = [], isPending: workspacesLoading } =
    useOrganizationWorkspaces(organizationId, !!organizationId && currentUserIsOrgAdmin)

  const accessControlEnabledLocally = isTruthy(getEnv('NEXT_PUBLIC_ACCESS_CONTROL_ENABLED'))
  const isEntitled = accessControlEnabledLocally || !!userPermissionConfig?.entitled
  const canManage = isEntitled && currentUserIsOrgAdmin && !!organizationId

  const isLoading =
    !workspaceId ||
    entitlementLoading ||
    (!!organizationId && currentUserIsOrgAdmin && groupsLoading)

  const createPermissionGroup = useCreatePermissionGroup()

  const [searchTerm, setSearchTerm] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDescription, setNewGroupDescription] = useState('')
  const [newGroupIsDefault, setNewGroupIsDefault] = useState(false)
  const [newGroupWorkspaceIds, setNewGroupWorkspaceIds] = useState<string[]>([])
  const [createError, setCreateError] = useState<string | null>(null)

  const workspaceOptions = useMemo(
    () => organizationWorkspaces.map((ws) => ({ value: ws.id, label: ws.name })),
    [organizationWorkspaces]
  )

  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return permissionGroups
    const searchLower = searchTerm.toLowerCase()
    return permissionGroups.filter((g) => g.name.toLowerCase().includes(searchLower))
  }, [permissionGroups, searchTerm])

  const selectedGroup = useMemo(
    () => (selectedGroupId ? permissionGroups.find((g) => g.id === selectedGroupId) : undefined),
    [permissionGroups, selectedGroupId]
  )

  const handleCreatePermissionGroup = useCallback(async () => {
    if (!newGroupName.trim() || !organizationId) return
    setCreateError(null)
    try {
      await createPermissionGroup.mutateAsync({
        organizationId,
        name: newGroupName.trim(),
        description: newGroupDescription.trim() || undefined,
        isDefault: newGroupIsDefault,
        workspaceIds: newGroupIsDefault ? undefined : newGroupWorkspaceIds,
      })
      setShowCreateModal(false)
      setNewGroupName('')
      setNewGroupDescription('')
      setNewGroupIsDefault(false)
      setNewGroupWorkspaceIds([])
    } catch (error) {
      logger.error('Failed to create permission group', error)
      setCreateError(error instanceof Error ? error.message : 'Failed to create permission group')
    }
  }, [
    newGroupName,
    newGroupDescription,
    newGroupIsDefault,
    newGroupWorkspaceIds,
    organizationId,
    createPermissionGroup,
  ])

  const handleCloseCreateModal = useCallback(() => {
    setShowCreateModal(false)
    setNewGroupName('')
    setNewGroupDescription('')
    setNewGroupIsDefault(false)
    setNewGroupWorkspaceIds([])
    setCreateError(null)
  }, [])

  if (isLoading) {
    return null
  }

  if (!canManage) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
        {!organizationId
          ? "Access Control applies to organization workspaces. This workspace isn't part of an organization."
          : 'Only organization admins on Enterprise plans can manage Access Control settings.'}
      </div>
    )
  }

  if (selectedGroup && organizationId) {
    return (
      <GroupDetail
        group={selectedGroup}
        organizationId={organizationId}
        workspaceId={workspaceId}
        workspaceOptions={workspaceOptions}
        organizationWorkspaces={organizationWorkspaces}
        workspacesLoading={workspacesLoading}
        onBack={() => setSelectedGroupId(null)}
        onDeleted={() => setSelectedGroupId(null)}
      />
    )
  }

  return (
    <>
      <div className='flex h-full flex-col bg-[var(--bg)]'>
        <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
          <div />
          <div className='flex items-center'>
            <Chip leftIcon={Plus} variant='primary' onClick={() => setShowCreateModal(true)}>
              Create Group
            </Chip>
          </div>
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
          <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>
            <div className='flex flex-col gap-1'>
              <h1 className='font-medium text-[var(--text-body)] text-lg'>Access Control</h1>
              <p className='text-[var(--text-muted)] text-md'>
                Manage permission groups across every workspace in your organization.
              </p>
            </div>

            <div className='flex items-center gap-2'>
              <ChipInput
                icon={Search}
                placeholder='Search permission groups...'
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className='flex-1'
              />
            </div>

            <SettingsSection label={`Permission groups (${permissionGroups.length})`}>
              {permissionGroups.length === 0 ? (
                <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
                  No permission groups yet. Click "Create Group" to get started.
                </div>
              ) : filteredGroups.length === 0 ? (
                <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
                  No groups found matching "{searchTerm}"
                </div>
              ) : (
                <div className='-mx-2 flex flex-col gap-y-0.5'>
                  {filteredGroups.map((group) => (
                    <button
                      key={group.id}
                      type='button'
                      onClick={() => setSelectedGroupId(group.id)}
                      className='flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
                    >
                      <div className='flex min-w-0 flex-1 flex-col'>
                        <div className='flex items-center gap-2'>
                          <span className='truncate text-[14px] text-[var(--text-body)]'>
                            {group.name}
                          </span>
                          {group.isDefault && (
                            <ChipTag variant='gray' className='flex-shrink-0'>
                              Default
                            </ChipTag>
                          )}
                        </div>
                        <span className='truncate text-[12px] text-[var(--text-muted)]'>
                          {group.isDefault
                            ? 'Everyone in the organization'
                            : `${
                                group.memberCount === 0
                                  ? 'All members'
                                  : `${group.memberCount} member${group.memberCount === 1 ? '' : 's'}`
                              } · ${group.workspaces.length} workspace${
                                group.workspaces.length === 1 ? '' : 's'
                              }`}
                        </span>
                      </div>
                      <ArrowRight className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                    </button>
                  ))}
                </div>
              )}
            </SettingsSection>
          </div>
        </div>
      </div>

      <ChipModal
        open={showCreateModal}
        onOpenChange={handleCloseCreateModal}
        size='sm'
        srTitle='Create Permission Group'
      >
        <ChipModalHeader onClose={handleCloseCreateModal}>Create Permission Group</ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='input'
            title='Name'
            value={newGroupName}
            onChange={(value) => {
              setNewGroupName(value)
              if (createError) setCreateError(null)
            }}
            placeholder='e.g., Marketing Team'
          />
          <ChipModalField
            type='input'
            title='Description (optional)'
            value={newGroupDescription}
            onChange={(value) => setNewGroupDescription(value)}
            placeholder='e.g., Limited access for marketing users'
          />
          <ChipModalField type='custom' title='Membership'>
            <div className='flex items-center gap-2'>
              <Checkbox
                id='default-group'
                checked={newGroupIsDefault}
                onCheckedChange={(checked) => {
                  const isDefault = checked === true
                  setNewGroupIsDefault(isDefault)
                  if (isDefault) setNewGroupWorkspaceIds([])
                }}
              />
              <Label htmlFor='default-group' className='cursor-pointer font-normal'>
                Make this the organization default group
              </Label>
            </div>
          </ChipModalField>
          <ChipModalField type='custom' title='Workspaces'>
            <div className='flex flex-col gap-1.5'>
              <WorkspaceSelect
                workspaceIds={newGroupWorkspaceIds}
                onChange={setNewGroupWorkspaceIds}
                options={workspaceOptions}
                disabled={newGroupIsDefault}
                isLoading={workspacesLoading}
                allowAllWorkspaces={newGroupIsDefault}
                fullWidth
              />
              {!newGroupIsDefault && (
                <p className='text-[var(--text-muted)] text-xs'>
                  Applies to all members of the selected workspaces. Restrict to specific people
                  later from the group's Members section.
                </p>
              )}
            </div>
          </ChipModalField>
          <ChipModalError>{createError}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={handleCloseCreateModal}
          primaryAction={{
            label: createPermissionGroup.isPending ? 'Creating...' : 'Create',
            onClick: handleCreatePermissionGroup,
            disabled:
              !newGroupName.trim() ||
              createPermissionGroup.isPending ||
              (!newGroupIsDefault && newGroupWorkspaceIds.length === 0),
          }}
        />
      </ChipModal>
    </>
  )
}
