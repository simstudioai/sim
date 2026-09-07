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
import { Plus } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import {
  groupIdParam,
  groupIdUrlKeys,
  groupSearchParam,
  groupSearchUrlKeys,
  groupStatusParam,
  groupStatusUrlKeys,
  groupTabParam,
  groupTabUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
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
  const { features } = useDeploymentShape()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : undefined

  /**
   * Access control is governed by the workspace's OWNING organization, which may
   * differ from the caller's active org (e.g. external members). Resolve the org
   * id and the caller's admin status server-side from the workspace so gating is
   * never keyed off the session's active org.
   */
  const {
    data: userPermissionConfig,
    isPending: entitlementLoading,
    error: entitlementError,
  } = useUserPermissionConfig(workspaceId)
  const {
    data: organizationBillingData,
    isPending: organizationBillingLoading,
    error: organizationBillingError,
  } = useOrganizationBilling(organizationId, {
    enabled: !features.accessControl && !userPermissionConfig?.entitled,
  })
  const currentUserIsOrgAdmin = isOrganizationAdmin

  const {
    data: permissionGroups = [],
    isPending: groupsLoading,
    error: groupsError,
    isFetching: groupsFetching,
    refetch: refetchGroups,
  } = usePermissionGroups(organizationId, !!organizationId && currentUserIsOrgAdmin)
  const { data: organizationWorkspaces = [], isPending: workspacesLoading } =
    useOrganizationWorkspaces(organizationId, !!organizationId && currentUserIsOrgAdmin)

  /**
   * Must be the resolved flag, not the raw `NEXT_PUBLIC_ACCESS_CONTROL_ENABLED`
   * read. The settings nav decides visibility from the same resolver, so
   * reading the bare var here let a deployment with only `ENTERPRISE_ENABLED`
   * set show the section and then refuse to manage it.
   */
  const isEntitled =
    features.accessControl ||
    !!userPermissionConfig?.entitled ||
    isEnterprise(organizationBillingData?.data?.subscriptionPlan)
  const canManage = isEntitled && currentUserIsOrgAdmin && !!organizationId
  const organizationEntitlementLoading =
    !features.accessControl && !userPermissionConfig?.entitled && organizationBillingLoading

  const isLoading =
    (workspaceId ? entitlementLoading : false) ||
    organizationEntitlementLoading ||
    (!!organizationId && currentUserIsOrgAdmin && groupsLoading)

  const createPermissionGroup = useCreatePermissionGroup()

  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [selectedGroupId, setSelectedGroupId] = useQueryState(groupIdParam.key, {
    ...groupIdParam.parser,
    ...groupIdUrlKeys,
  })

  // Params scoped to the detail sub-view are cleared alongside the group id, so
  // a tab/search/filter can't linger on the list URL after going back. nuqs
  // batches these same-tick writes into a single URL update.
  const [, setGroupTab] = useQueryState(groupTabParam.key, {
    ...groupTabParam.parser,
    ...groupTabUrlKeys,
  })
  const [, setGroupSearch] = useQueryState(groupSearchParam.key, {
    ...groupSearchParam.parser,
    ...groupSearchUrlKeys,
  })
  const [, setGroupStatus] = useQueryState(groupStatusParam.key, {
    ...groupStatusParam.parser,
    ...groupStatusUrlKeys,
  })

  /**
   * The detail view's tab/search/status params are scoped to one group, so both
   * transitions reset them — otherwise a stale `group-id` that never resolves
   * leaves them in the URL and the next group opens on the previous group's tab
   * and filters. nuqs batches these same-tick writes into one URL update.
   */
  const openGroupDetail = (groupId: string) => {
    void setSelectedGroupId(groupId)
    void setGroupTab(null)
    void setGroupSearch(null)
    void setGroupStatus(null)
  }

  const closeGroupDetail = useCallback(() => {
    void setSelectedGroupId(null, { history: 'replace' })
    void setGroupTab(null)
    void setGroupSearch(null)
    void setGroupStatus(null)
  }, [setSelectedGroupId, setGroupTab, setGroupSearch, setGroupStatus])
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

  const handleCreatePermissionGroup = async () => {
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
  }

  const handleCloseCreateModal = () => {
    setShowCreateModal(false)
    setNewGroupName('')
    setNewGroupDescription('')
    setNewGroupIsDefault(false)
    setNewGroupWorkspaceIds([])
    setCreateError(null)
  }

  const listSearch = {
    value: searchTerm,
    onChange: setSearchTerm,
    placeholder: 'Search permission groups...',
    disabled: isLoading,
  }
  const listActions = [
    {
      id: 'create-group',
      text: 'Create group',
      icon: Plus,
      variant: 'primary' as const,
      onSelect: () => setShowCreateModal(true),
      disabled: isLoading,
    },
  ]

  if (isLoading) {
    return <SettingsPanel search={listSearch} actions={listActions} />
  }

  const entitlementLoadError = isEntitled
    ? null
    : ((userPermissionConfig === undefined ? entitlementError : null) ??
      (organizationBillingData === undefined ? organizationBillingError : null))
  if (entitlementLoadError) {
    return (
      <SettingsEmptyState tone='error'>
        {getErrorMessage(entitlementLoadError, 'Failed to load Access Control access')}
      </SettingsEmptyState>
    )
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

  if (groupsError) {
    return (
      <SettingsPanel>
        <SettingsQueryErrorState
          error={groupsError}
          fallback='Failed to load permission groups'
          isRetrying={groupsFetching}
          onRetry={() => void refetchGroups()}
        />
      </SettingsPanel>
    )
  }

  if (selectedGroup && organizationId) {
    return (
      <GroupDetail
        key={selectedGroup.id}
        group={selectedGroup}
        organizationId={organizationId}
        workspaceId={workspaceId}
        workspaceOptions={workspaceOptions}
        organizationWorkspaces={organizationWorkspaces}
        workspacesLoading={workspacesLoading}
        onBack={closeGroupDetail}
        onDeleted={closeGroupDetail}
      />
    )
  }

  return (
    <>
      <SettingsPanel search={listSearch} actions={listActions}>
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
            <div className={RESOURCE_LIST_STACK}>
              {filteredGroups.map((group) => (
                <SettingsResourceRow
                  key={group.id}
                  title={group.name}
                  description={
                    group.isDefault
                      ? 'Everyone in the organization'
                      : `${
                          group.memberCount === 0
                            ? 'All members'
                            : `${group.memberCount} member${group.memberCount === 1 ? '' : 's'}`
                        } · ${group.workspaces.length} workspace${
                          group.workspaces.length === 1 ? '' : 's'
                        }`
                  }
                  badge={group.isDefault ? <ChipTag variant='gray'>Default</ChipTag> : undefined}
                  onClick={() => openGroupDetail(group.id)}
                  clickLabel={`Open ${group.name}`}
                  navigable
                />
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
