'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  Checkbox,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipTag,
  Label,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { ArrowRight, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import {
  groupIdParam,
  groupIdUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { GroupDetail } from '@/ee/access-control/components/group-detail'
import { WorkspaceSelect } from '@/ee/access-control/components/workspace-select'
import {
  useCreatePermissionGroup,
  useOrganizationWorkspaces,
  usePermissionGroups,
  useUserPermissionConfig,
} from '@/ee/access-control/hooks/permission-groups'
import { useOrganizationBilling } from '@/hooks/queries/organization'

const logger = createLogger('AccessControl')

interface AccessControlProps {
  isOrganizationAdmin: boolean
  organizationId: string
}

export function AccessControl({ isOrganizationAdmin, organizationId }: AccessControlProps) {
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
  const { data: organizationBillingData, isPending: organizationBillingLoading } =
    useOrganizationBilling(organizationId)
  const currentUserIsOrgAdmin = isOrganizationAdmin

  const { data: permissionGroups = [], isPending: groupsLoading } = usePermissionGroups(
    organizationId,
    !!organizationId && currentUserIsOrgAdmin
  )
  const { data: organizationWorkspaces = [], isPending: workspacesLoading } =
    useOrganizationWorkspaces(organizationId, !!organizationId && currentUserIsOrgAdmin)

  const accessControlEnabledLocally = isTruthy(getEnv('NEXT_PUBLIC_ACCESS_CONTROL_ENABLED'))
  const isEntitled =
    accessControlEnabledLocally ||
    !!userPermissionConfig?.entitled ||
    isEnterprise(organizationBillingData?.data?.subscriptionPlan)
  const canManage = isEntitled && currentUserIsOrgAdmin && !!organizationId

  const isLoading =
    (workspaceId ? entitlementLoading : organizationBillingLoading) ||
    (!!organizationId && currentUserIsOrgAdmin && groupsLoading)

  const createPermissionGroup = useCreatePermissionGroup()

  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [selectedGroupId, setSelectedGroupId] = useQueryState(groupIdParam.key, {
    ...groupIdParam.parser,
    ...groupIdUrlKeys,
  })
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
      setCreateError(getErrorMessage(error, 'Failed to create permission group'))
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
      <SettingsEmptyState>
        {!organizationId
          ? "Access Control applies to organization workspaces. This workspace isn't part of an organization."
          : 'Only organization admins on Enterprise plans can manage Access Control settings.'}
      </SettingsEmptyState>
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
        onBack={() => void setSelectedGroupId(null, { history: 'replace' })}
        onDeleted={() => void setSelectedGroupId(null, { history: 'replace' })}
      />
    )
  }

  return (
    <>
      <SettingsPanel
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search permission groups...',
        }}
        actions={[
          {
            text: 'Create group',
            icon: Plus,
            variant: 'primary',
            onSelect: () => setShowCreateModal(true),
          },
        ]}
      >
        <SettingsSection label={`Permission groups (${permissionGroups.length})`}>
          {permissionGroups.length === 0 ? (
            <SettingsEmptyState variant='inline'>
              No permission groups yet. Click "Create group" to get started.
            </SettingsEmptyState>
          ) : filteredGroups.length === 0 ? (
            <SettingsEmptyState variant='inline'>
              No groups found matching "{searchTerm}"
            </SettingsEmptyState>
          ) : (
            <div className='-mx-2 flex flex-col gap-y-0.5'>
              {filteredGroups.map((group) => (
                <button
                  key={group.id}
                  type='button'
                  onClick={() => void setSelectedGroupId(group.id)}
                  className='flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
                >
                  <div className='flex min-w-0 flex-1 flex-col'>
                    <div className='flex items-center gap-2'>
                      <span className='truncate text-[var(--text-body)] text-sm'>{group.name}</span>
                      {group.isDefault && (
                        <ChipTag variant='gray' className='flex-shrink-0'>
                          Default
                        </ChipTag>
                      )}
                    </div>
                    <span className='truncate text-[var(--text-muted)] text-caption'>
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
                  <ArrowRight className='size-4 flex-shrink-0 text-[var(--text-icon)]' />
                </button>
              ))}
            </div>
          )}
        </SettingsSection>
      </SettingsPanel>

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
