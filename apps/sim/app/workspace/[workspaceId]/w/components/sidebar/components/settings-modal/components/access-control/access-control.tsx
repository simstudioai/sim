'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Check, Plus, Search, Users } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Checkbox,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { Input as BaseInput, Skeleton } from '@/components/ui'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionStatus } from '@/lib/billing/client'
import { cn } from '@/lib/core/utils/cn'
import type { PermissionGroupConfig } from '@/lib/permission-groups/types'
import { getUserRole } from '@/lib/workspaces/organization'
import { getUserColor } from '@/app/workspace/[workspaceId]/w/utils/get-user-color'
import { getAllBlocks } from '@/blocks'
import { useOrganization, useOrganizations } from '@/hooks/queries/organization'
import {
  type PermissionGroup,
  useBulkAddPermissionGroupMembers,
  useCreatePermissionGroup,
  useDeletePermissionGroup,
  usePermissionGroupMembers,
  usePermissionGroups,
  useRemovePermissionGroupMember,
  useUpdatePermissionGroup,
} from '@/hooks/queries/permission-groups'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import { getAllProviderIds } from '@/providers/utils'

const logger = createLogger('AccessControl')

function AccessControlSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[16px]'>
      <div className='flex flex-col gap-[8px]'>
        <Skeleton className='h-[14px] w-[100px]' />
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[12px]'>
            <Skeleton className='h-9 w-9 rounded-[6px]' />
            <div className='flex flex-col gap-[4px]'>
              <Skeleton className='h-[14px] w-[120px]' />
              <Skeleton className='h-[12px] w-[80px]' />
            </div>
          </div>
          <Skeleton className='h-[32px] w-[60px] rounded-[6px]' />
        </div>
      </div>
    </div>
  )
}

export function AccessControl() {
  const { data: session } = useSession()
  const { data: organizationsData, isPending: orgsLoading } = useOrganizations()
  const { data: subscriptionData, isPending: subLoading } = useSubscriptionData()

  const activeOrganization = organizationsData?.activeOrganization
  const subscriptionStatus = getSubscriptionStatus(subscriptionData?.data)
  const hasEnterprisePlan = subscriptionStatus.isEnterprise
  const userRole = getUserRole(activeOrganization, session?.user?.email)
  const isOwner = userRole === 'owner'
  const isAdmin = userRole === 'admin'
  const isOrgAdminOrOwner = isOwner || isAdmin
  const canManage = hasEnterprisePlan && isOrgAdminOrOwner && !!activeOrganization?.id

  const queryEnabled = !!activeOrganization?.id
  const { data: permissionGroups = [], isPending: groupsLoading } = usePermissionGroups(
    activeOrganization?.id,
    queryEnabled
  )

  // Show loading while dependencies load, or while permission groups query is pending
  const isLoading = orgsLoading || subLoading || (queryEnabled && groupsLoading)
  const { data: organization } = useOrganization(activeOrganization?.id || '')

  const createPermissionGroup = useCreatePermissionGroup()
  const updatePermissionGroup = useUpdatePermissionGroup()
  const deletePermissionGroup = useDeletePermissionGroup()
  const bulkAddMembers = useBulkAddPermissionGroupMembers()

  const [searchTerm, setSearchTerm] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [viewingGroup, setViewingGroup] = useState<PermissionGroup | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDescription, setNewGroupDescription] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<{ id: string; name: string } | null>(null)
  const [deletingGroupIds, setDeletingGroupIds] = useState<Set<string>>(new Set())

  const { data: members = [], isPending: membersLoading } = usePermissionGroupMembers(
    viewingGroup?.id
  )
  const removeMember = useRemovePermissionGroupMember()

  const [showConfigModal, setShowConfigModal] = useState(false)
  const [editingConfig, setEditingConfig] = useState<PermissionGroupConfig | null>(null)
  const [showAddMembersModal, setShowAddMembersModal] = useState(false)
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set())
  const [providerSearchTerm, setProviderSearchTerm] = useState('')
  const [integrationSearchTerm, setIntegrationSearchTerm] = useState('')

  const allBlocks = useMemo(() => {
    const blocks = getAllBlocks().filter((b) => !b.hideFromToolbar)
    return blocks.sort((a, b) => {
      // Group by category: triggers first, then blocks, then tools
      const categoryOrder = { triggers: 0, blocks: 1, tools: 2 }
      const catA = categoryOrder[a.category] ?? 3
      const catB = categoryOrder[b.category] ?? 3
      if (catA !== catB) return catA - catB
      return a.name.localeCompare(b.name)
    })
  }, [])
  const allProviderIds = useMemo(() => getAllProviderIds(), [])

  const filteredProviders = useMemo(() => {
    if (!providerSearchTerm.trim()) return allProviderIds
    const query = providerSearchTerm.toLowerCase()
    return allProviderIds.filter((id) => id.toLowerCase().includes(query))
  }, [allProviderIds, providerSearchTerm])

  const filteredBlocks = useMemo(() => {
    if (!integrationSearchTerm.trim()) return allBlocks
    const query = integrationSearchTerm.toLowerCase()
    return allBlocks.filter((b) => b.name.toLowerCase().includes(query))
  }, [allBlocks, integrationSearchTerm])

  const orgMembers = useMemo(() => {
    return organization?.members || []
  }, [organization])

  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return permissionGroups
    const searchLower = searchTerm.toLowerCase()
    return permissionGroups.filter((g) => g.name.toLowerCase().includes(searchLower))
  }, [permissionGroups, searchTerm])

  const handleCreatePermissionGroup = useCallback(async () => {
    if (!newGroupName.trim() || !activeOrganization?.id) return
    setCreateError(null)
    try {
      const result = await createPermissionGroup.mutateAsync({
        organizationId: activeOrganization.id,
        name: newGroupName.trim(),
        description: newGroupDescription.trim() || undefined,
      })
      setShowCreateModal(false)
      setNewGroupName('')
      setNewGroupDescription('')
    } catch (error) {
      logger.error('Failed to create permission group', error)
      if (error instanceof Error) {
        setCreateError(error.message)
      } else {
        setCreateError('Failed to create permission group')
      }
    }
  }, [newGroupName, newGroupDescription, activeOrganization?.id, createPermissionGroup])

  const handleCloseCreateModal = useCallback(() => {
    setShowCreateModal(false)
    setNewGroupName('')
    setNewGroupDescription('')
    setCreateError(null)
  }, [])

  const handleBackToList = useCallback(() => {
    setViewingGroup(null)
  }, [])

  const handleDeleteClick = useCallback((group: PermissionGroup) => {
    setDeletingGroup({ id: group.id, name: group.name })
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!deletingGroup || !activeOrganization?.id) return
    setDeletingGroupIds((prev) => new Set(prev).add(deletingGroup.id))
    try {
      await deletePermissionGroup.mutateAsync({
        permissionGroupId: deletingGroup.id,
        organizationId: activeOrganization.id,
      })
      setDeletingGroup(null)
      if (viewingGroup?.id === deletingGroup.id) {
        setViewingGroup(null)
      }
    } catch (error) {
      logger.error('Failed to delete permission group', error)
    } finally {
      setDeletingGroupIds((prev) => {
        const next = new Set(prev)
        next.delete(deletingGroup.id)
        return next
      })
    }
  }, [deletingGroup, activeOrganization?.id, deletePermissionGroup, viewingGroup?.id])

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
      if (!viewingGroup) return
      try {
        await removeMember.mutateAsync({
          permissionGroupId: viewingGroup.id,
          memberId,
        })
      } catch (error) {
        logger.error('Failed to remove member', error)
      }
    },
    [viewingGroup, removeMember]
  )

  const handleOpenConfigModal = useCallback(() => {
    if (!viewingGroup) return
    setEditingConfig({ ...viewingGroup.config })
    setShowConfigModal(true)
  }, [viewingGroup])

  const handleSaveConfig = useCallback(async () => {
    if (!viewingGroup || !editingConfig || !activeOrganization?.id) return
    try {
      await updatePermissionGroup.mutateAsync({
        id: viewingGroup.id,
        organizationId: activeOrganization.id,
        config: editingConfig,
      })
      setShowConfigModal(false)
      setEditingConfig(null)
      setProviderSearchTerm('')
      setIntegrationSearchTerm('')
      setViewingGroup((prev) => (prev ? { ...prev, config: editingConfig } : null))
    } catch (error) {
      logger.error('Failed to update config', error)
    }
  }, [viewingGroup, editingConfig, activeOrganization?.id, updatePermissionGroup])

  const handleOpenAddMembersModal = useCallback(() => {
    const existingMemberUserIds = new Set(members.map((m) => m.userId))
    setSelectedMemberIds(new Set())
    setShowAddMembersModal(true)
  }, [members])

  const handleAddSelectedMembers = useCallback(async () => {
    if (!viewingGroup || selectedMemberIds.size === 0) return
    try {
      await bulkAddMembers.mutateAsync({
        permissionGroupId: viewingGroup.id,
        userIds: Array.from(selectedMemberIds),
      })
      setShowAddMembersModal(false)
      setSelectedMemberIds(new Set())
    } catch (error) {
      logger.error('Failed to add members', error)
    }
  }, [viewingGroup, selectedMemberIds, bulkAddMembers])

  const toggleIntegration = useCallback(
    (blockType: string) => {
      if (!editingConfig) return
      const current = editingConfig.allowedIntegrations
      if (current === null) {
        const allExcept = allBlocks.map((b) => b.type).filter((t) => t !== blockType)
        setEditingConfig({ ...editingConfig, allowedIntegrations: allExcept })
      } else if (current.includes(blockType)) {
        const updated = current.filter((t) => t !== blockType)
        setEditingConfig({
          ...editingConfig,
          allowedIntegrations: updated.length === allBlocks.length ? null : updated,
        })
      } else {
        const updated = [...current, blockType]
        setEditingConfig({
          ...editingConfig,
          allowedIntegrations: updated.length === allBlocks.length ? null : updated,
        })
      }
    },
    [editingConfig, allBlocks]
  )

  const toggleProvider = useCallback(
    (providerId: string) => {
      if (!editingConfig) return
      const current = editingConfig.allowedModelProviders
      if (current === null) {
        const allExcept = allProviderIds.filter((p) => p !== providerId)
        setEditingConfig({ ...editingConfig, allowedModelProviders: allExcept })
      } else if (current.includes(providerId)) {
        const updated = current.filter((p) => p !== providerId)
        setEditingConfig({
          ...editingConfig,
          allowedModelProviders: updated.length === allProviderIds.length ? null : updated,
        })
      } else {
        const updated = [...current, providerId]
        setEditingConfig({
          ...editingConfig,
          allowedModelProviders: updated.length === allProviderIds.length ? null : updated,
        })
      }
    },
    [editingConfig, allProviderIds]
  )

  const isIntegrationAllowed = useCallback(
    (blockType: string) => {
      if (!editingConfig) return true
      return (
        editingConfig.allowedIntegrations === null ||
        editingConfig.allowedIntegrations.includes(blockType)
      )
    },
    [editingConfig]
  )

  const isProviderAllowed = useCallback(
    (providerId: string) => {
      if (!editingConfig) return true
      return (
        editingConfig.allowedModelProviders === null ||
        editingConfig.allowedModelProviders.includes(providerId)
      )
    },
    [editingConfig]
  )

  const availableMembersToAdd = useMemo(() => {
    const existingMemberUserIds = new Set(members.map((m) => m.userId))
    return orgMembers.filter((m: any) => !existingMemberUserIds.has(m.userId))
  }, [orgMembers, members])

  if (isLoading) {
    return <AccessControlSkeleton />
  }

  if (viewingGroup) {
    return (
      <>
        <div className='flex h-full flex-col gap-[16px]'>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            <div className='flex flex-col gap-[16px]'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-[16px]'>
                  <div className='flex items-center gap-[8px]'>
                    <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                      Group Name
                    </span>
                    <span className='text-[13px] text-[var(--text-secondary)]'>
                      {viewingGroup.name}
                    </span>
                  </div>
                  {viewingGroup.description && (
                    <>
                      <div className='h-4 w-px bg-[var(--border)]' />
                      <span className='text-[13px] text-[var(--text-muted)]'>
                        {viewingGroup.description}
                      </span>
                    </>
                  )}
                </div>
                <Button variant='tertiary' onClick={handleOpenConfigModal}>
                  Configure
                </Button>
              </div>

              <div className='flex flex-col gap-[16px]'>
                <div className='flex items-center justify-between'>
                  <h4 className='font-medium text-[14px] text-[var(--text-primary)]'>Members</h4>
                  <Button variant='tertiary' onClick={handleOpenAddMembersModal}>
                    <Plus className='mr-[6px] h-[13px] w-[13px]' />
                    Add Members
                  </Button>
                </div>

                {membersLoading ? (
                  <div className='flex flex-col gap-[16px]'>
                    {[1, 2].map((i) => (
                      <div key={i} className='flex items-center justify-between'>
                        <div className='flex items-center gap-[12px]'>
                          <Skeleton className='h-8 w-8 rounded-full' />
                          <div className='flex flex-col gap-[4px]'>
                            <Skeleton className='h-[14px] w-[100px]' />
                            <Skeleton className='h-[12px] w-[150px]' />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : members.length === 0 ? (
                  <p className='text-[13px] text-[var(--text-muted)]'>
                    No members yet. Add members using the buttons above.
                  </p>
                ) : (
                  <div className='flex flex-col gap-[16px]'>
                    {members.map((member) => {
                      const name = member.userName || 'Unknown'
                      const avatarInitial = name.charAt(0).toUpperCase()

                      return (
                        <div key={member.id} className='flex items-center justify-between'>
                          <div className='flex flex-1 items-center gap-[12px]'>
                            <Avatar size='sm'>
                              {member.userImage && (
                                <AvatarImage src={member.userImage} alt={name} />
                              )}
                              <AvatarFallback
                                style={{
                                  background: getUserColor(member.userId || member.userEmail || ''),
                                }}
                                className='border-0 text-white'
                              >
                                {avatarInitial}
                              </AvatarFallback>
                            </Avatar>

                            <div className='min-w-0'>
                              <div className='flex items-center gap-[8px]'>
                                <span className='truncate font-medium text-[14px] text-[var(--text-primary)]'>
                                  {name}
                                </span>
                              </div>
                              <div className='truncate text-[12px] text-[var(--text-muted)]'>
                                {member.userEmail}
                              </div>
                            </div>
                          </div>

                          <div className='ml-[16px] flex items-center gap-[4px]'>
                            <Button
                              variant='destructive'
                              onClick={() => handleRemoveMember(member.id)}
                              disabled={removeMember.isPending}
                              className='h-8'
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className='mt-auto flex items-center justify-end'>
            <Button onClick={handleBackToList} variant='tertiary'>
              Back
            </Button>
          </div>
        </div>

        <Modal open={showConfigModal} onOpenChange={setShowConfigModal}>
          <ModalContent size='xl' className='max-h-[80vh]'>
            <ModalHeader>Configure Permissions</ModalHeader>
            <ModalBody className='max-h-[60vh] overflow-y-auto'>
              <div className='flex flex-col gap-[20px]'>
                <div className='flex flex-col gap-[8px]'>
                  <div className='flex items-center justify-between'>
                    <Label>Allowed Model Providers</Label>
                    <button
                      type='button'
                      onClick={() => {
                        const allAllowed =
                          editingConfig?.allowedModelProviders === null ||
                          editingConfig?.allowedModelProviders?.length === allProviderIds.length
                        setEditingConfig((prev) =>
                          prev ? { ...prev, allowedModelProviders: allAllowed ? [] : null } : prev
                        )
                      }}
                      className='text-[12px] text-[var(--accent)] hover:underline'
                    >
                      {editingConfig?.allowedModelProviders === null ||
                      editingConfig?.allowedModelProviders?.length === allProviderIds.length
                        ? 'Deselect All'
                        : 'Select All'}
                    </button>
                  </div>
                  <p className='text-[12px] text-[var(--text-muted)]'>
                    Select which model providers are available in agent dropdowns. All are allowed
                    by default.
                  </p>
                  <div className='flex items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px]'>
                    <Search className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]' />
                    <BaseInput
                      placeholder='Search providers...'
                      value={providerSearchTerm}
                      onChange={(e) => setProviderSearchTerm(e.target.value)}
                      className='h-auto flex-1 border-0 bg-transparent p-0 font-base text-[13px] leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
                    />
                  </div>
                  <div className='grid grid-cols-3 gap-[8px]'>
                    {filteredProviders.map((providerId) => (
                      <button
                        key={providerId}
                        type='button'
                        onClick={() => toggleProvider(providerId)}
                        className={cn(
                          'flex items-center justify-between rounded-[6px] border px-[10px] py-[6px] text-[13px] transition-colors',
                          isProviderAllowed(providerId)
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text-primary)]'
                            : 'border-[var(--border)] bg-transparent text-[var(--text-muted)]'
                        )}
                      >
                        <span className='capitalize'>{providerId.replace('-', ' ')}</span>
                        {isProviderAllowed(providerId) && (
                          <Check className='h-[14px] w-[14px] text-[var(--accent)]' />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div className='flex flex-col gap-[8px]'>
                  <div className='flex items-center justify-between'>
                    <Label>Allowed Integrations</Label>
                    <button
                      type='button'
                      onClick={() => {
                        const allAllowed =
                          editingConfig?.allowedIntegrations === null ||
                          editingConfig?.allowedIntegrations?.length === allBlocks.length
                        setEditingConfig((prev) =>
                          prev ? { ...prev, allowedIntegrations: allAllowed ? [] : null } : prev
                        )
                      }}
                      className='text-[12px] text-[var(--accent)] hover:underline'
                    >
                      {editingConfig?.allowedIntegrations === null ||
                      editingConfig?.allowedIntegrations?.length === allBlocks.length
                        ? 'Deselect All'
                        : 'Select All'}
                    </button>
                  </div>
                  <p className='text-[12px] text-[var(--text-muted)]'>
                    Select which integrations are visible in the toolbar. All are visible by
                    default.
                  </p>
                  <div className='flex items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px]'>
                    <Search className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]' />
                    <BaseInput
                      placeholder='Search integrations...'
                      value={integrationSearchTerm}
                      onChange={(e) => setIntegrationSearchTerm(e.target.value)}
                      className='h-auto flex-1 border-0 bg-transparent p-0 font-base text-[13px] leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
                    />
                  </div>
                  <div className='grid max-h-[200px] grid-cols-3 gap-[8px] overflow-y-auto'>
                    {filteredBlocks.map((block) => (
                      <button
                        key={block.type}
                        type='button'
                        onClick={() => toggleIntegration(block.type)}
                        className={cn(
                          'flex items-center justify-between rounded-[6px] border px-[10px] py-[6px] text-[13px] transition-colors',
                          isIntegrationAllowed(block.type)
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text-primary)]'
                            : 'border-[var(--border)] bg-transparent text-[var(--text-muted)]'
                        )}
                      >
                        <span className='truncate'>{block.name}</span>
                        {isIntegrationAllowed(block.type) && (
                          <Check className='h-[14px] w-[14px] flex-shrink-0 text-[var(--accent)]' />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div className='flex flex-col gap-[8px]'>
                  <div className='flex items-center justify-between'>
                    <Label>Platform Configuration</Label>
                    <button
                      type='button'
                      onClick={() => {
                        const allVisible =
                          !editingConfig?.hideKnowledgeBaseTab &&
                          !editingConfig?.hideTemplates &&
                          !editingConfig?.hideCopilot &&
                          !editingConfig?.hideApiKeysTab &&
                          !editingConfig?.hideEnvironmentTab &&
                          !editingConfig?.hideFilesTab &&
                          !editingConfig?.disableMcpTools &&
                          !editingConfig?.disableCustomTools &&
                          !editingConfig?.hideTraceSpans
                        setEditingConfig((prev) =>
                          prev
                            ? {
                                ...prev,
                                hideKnowledgeBaseTab: allVisible,
                                hideTemplates: allVisible,
                                hideCopilot: allVisible,
                                hideApiKeysTab: allVisible,
                                hideEnvironmentTab: allVisible,
                                hideFilesTab: allVisible,
                                disableMcpTools: allVisible,
                                disableCustomTools: allVisible,
                                hideTraceSpans: allVisible,
                              }
                            : prev
                        )
                      }}
                      className='text-[12px] text-[var(--accent)] hover:underline'
                    >
                      {!editingConfig?.hideKnowledgeBaseTab &&
                      !editingConfig?.hideTemplates &&
                      !editingConfig?.hideCopilot &&
                      !editingConfig?.hideApiKeysTab &&
                      !editingConfig?.hideEnvironmentTab &&
                      !editingConfig?.hideFilesTab &&
                      !editingConfig?.disableMcpTools &&
                      !editingConfig?.disableCustomTools &&
                      !editingConfig?.hideTraceSpans
                        ? 'Deselect All'
                        : 'Select All'}
                    </button>
                  </div>
                  <p className='text-[12px] text-[var(--text-muted)]'>
                    Checked features are visible. Uncheck to hide.
                  </p>
                  <div className='flex flex-col gap-[16px] rounded-[8px] border border-[var(--border)] p-[12px]'>
                    {/* Sidebar */}
                    <div className='flex flex-col gap-[8px]'>
                      <span className='text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]'>
                        Sidebar
                      </span>
                      <div className='flex flex-col gap-[8px] pl-[2px]'>
                        <div className='flex items-center gap-[12px]'>
                          <Checkbox
                            id='hide-knowledge-base'
                            checked={!editingConfig?.hideKnowledgeBaseTab}
                            onCheckedChange={(checked) =>
                              setEditingConfig((prev) =>
                                prev ? { ...prev, hideKnowledgeBaseTab: checked !== true } : prev
                              )
                            }
                          />
                          <Label
                            htmlFor='hide-knowledge-base'
                            className='cursor-pointer text-[13px] font-normal'
                          >
                            Knowledge Base
                          </Label>
                        </div>
                        <div className='flex items-center gap-[12px]'>
                          <Checkbox
                            id='hide-templates'
                            checked={!editingConfig?.hideTemplates}
                            onCheckedChange={(checked) =>
                              setEditingConfig((prev) =>
                                prev ? { ...prev, hideTemplates: checked !== true } : prev
                              )
                            }
                          />
                          <Label
                            htmlFor='hide-templates'
                            className='cursor-pointer text-[13px] font-normal'
                          >
                            Templates
                          </Label>
                        </div>
                      </div>
                    </div>

                    {/* Workflow Panel */}
                    <div className='flex flex-col gap-[8px]'>
                      <span className='text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]'>
                        Workflow Panel
                      </span>
                      <div className='flex flex-col gap-[8px] pl-[2px]'>
                        <div className='flex items-center gap-[12px]'>
                          <Checkbox
                            id='hide-copilot'
                            checked={!editingConfig?.hideCopilot}
                            onCheckedChange={(checked) =>
                              setEditingConfig((prev) =>
                                prev ? { ...prev, hideCopilot: checked !== true } : prev
                              )
                            }
                          />
                          <Label
                            htmlFor='hide-copilot'
                            className='cursor-pointer text-[13px] font-normal'
                          >
                            Copilot
                          </Label>
                        </div>
                      </div>
                    </div>

                    {/* Settings Tabs */}
                    <div className='flex flex-col gap-[8px]'>
                      <span className='text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]'>
                        Settings Tabs
                      </span>
                      <div className='flex flex-col gap-[8px] pl-[2px]'>
                        <div className='flex items-center gap-[12px]'>
                          <Checkbox
                            id='hide-api-keys'
                            checked={!editingConfig?.hideApiKeysTab}
                            onCheckedChange={(checked) =>
                              setEditingConfig((prev) =>
                                prev ? { ...prev, hideApiKeysTab: checked !== true } : prev
                              )
                            }
                          />
                          <Label
                            htmlFor='hide-api-keys'
                            className='cursor-pointer text-[13px] font-normal'
                          >
                            API Keys
                          </Label>
                        </div>
                        <div className='flex items-center gap-[12px]'>
                          <Checkbox
                            id='hide-environment'
                            checked={!editingConfig?.hideEnvironmentTab}
                            onCheckedChange={(checked) =>
                              setEditingConfig((prev) =>
                                prev ? { ...prev, hideEnvironmentTab: checked !== true } : prev
                              )
                            }
                          />
                          <Label
                            htmlFor='hide-environment'
                            className='cursor-pointer text-[13px] font-normal'
                          >
                            Environment
                          </Label>
                        </div>
                        <div className='flex items-center gap-[12px]'>
                          <Checkbox
                            id='hide-files'
                            checked={!editingConfig?.hideFilesTab}
                            onCheckedChange={(checked) =>
                              setEditingConfig((prev) =>
                                prev ? { ...prev, hideFilesTab: checked !== true } : prev
                              )
                            }
                          />
                          <Label
                            htmlFor='hide-files'
                            className='cursor-pointer text-[13px] font-normal'
                          >
                            Files
                          </Label>
                        </div>
                      </div>
                    </div>

                    {/* Tools */}
                    <div className='flex flex-col gap-[8px]'>
                      <span className='text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]'>
                        Tools
                      </span>
                      <div className='flex flex-col gap-[8px] pl-[2px]'>
                        <div className='flex items-center gap-[12px]'>
                          <Checkbox
                            id='disable-mcp'
                            checked={!editingConfig?.disableMcpTools}
                            onCheckedChange={(checked) =>
                              setEditingConfig((prev) =>
                                prev ? { ...prev, disableMcpTools: checked !== true } : prev
                              )
                            }
                          />
                          <Label
                            htmlFor='disable-mcp'
                            className='cursor-pointer text-[13px] font-normal'
                          >
                            MCP Tools
                          </Label>
                        </div>
                        <div className='flex items-center gap-[12px]'>
                          <Checkbox
                            id='disable-custom-tools'
                            checked={!editingConfig?.disableCustomTools}
                            onCheckedChange={(checked) =>
                              setEditingConfig((prev) =>
                                prev ? { ...prev, disableCustomTools: checked !== true } : prev
                              )
                            }
                          />
                          <Label
                            htmlFor='disable-custom-tools'
                            className='cursor-pointer text-[13px] font-normal'
                          >
                            Custom Tools
                          </Label>
                        </div>
                      </div>
                    </div>

                    {/* Logs */}
                    <div className='flex flex-col gap-[8px]'>
                      <span className='text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]'>
                        Logs
                      </span>
                      <div className='flex flex-col gap-[8px] pl-[2px]'>
                        <div className='flex items-center gap-[12px]'>
                          <Checkbox
                            id='hide-trace-spans'
                            checked={!editingConfig?.hideTraceSpans}
                            onCheckedChange={(checked) =>
                              setEditingConfig((prev) =>
                                prev ? { ...prev, hideTraceSpans: checked !== true } : prev
                              )
                            }
                          />
                          <Label
                            htmlFor='hide-trace-spans'
                            className='cursor-pointer text-[13px] font-normal'
                          >
                            Trace spans
                          </Label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                variant='default'
                onClick={() => {
                  setShowConfigModal(false)
                  setProviderSearchTerm('')
                  setIntegrationSearchTerm('')
                }}
              >
                Cancel
              </Button>
              <Button
                variant='tertiary'
                onClick={handleSaveConfig}
                disabled={updatePermissionGroup.isPending}
              >
                {updatePermissionGroup.isPending ? 'Saving...' : 'Save'}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        <Modal open={showAddMembersModal} onOpenChange={setShowAddMembersModal}>
          <ModalContent className='max-h-[80vh] w-[500px]'>
            <ModalHeader>Add Members</ModalHeader>
            <ModalBody className='max-h-[60vh] overflow-y-auto'>
              {availableMembersToAdd.length === 0 ? (
                <p className='text-[13px] text-[var(--text-muted)]'>
                  All organization members are already in this group.
                </p>
              ) : (
                <div className='flex flex-col gap-[12px]'>
                  <button
                    type='button'
                    onClick={() => {
                      const allIds = availableMembersToAdd.map((m: any) => m.userId)
                      const allSelected = allIds.every((id: string) => selectedMemberIds.has(id))
                      if (allSelected) {
                        setSelectedMemberIds(new Set())
                      } else {
                        setSelectedMemberIds(new Set(allIds))
                      }
                    }}
                    className={cn(
                      'flex items-center gap-[12px] rounded-[8px] border p-[12px] transition-colors',
                      selectedMemberIds.size === availableMembersToAdd.length
                        ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                        : 'border-[var(--border)] hover:bg-[var(--surface-5)]'
                    )}
                  >
                    <div className='flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-5)]'>
                      <Users className='h-4 w-4 text-[var(--text-secondary)]' />
                    </div>
                    <div className='min-w-0 flex-1 text-left'>
                      <div className='font-medium text-[14px] text-[var(--text-primary)]'>
                        Select All
                      </div>
                      <div className='text-[12px] text-[var(--text-muted)]'>
                        {availableMembersToAdd.length} member
                        {availableMembersToAdd.length !== 1 ? 's' : ''} available
                      </div>
                    </div>
                    {selectedMemberIds.size === availableMembersToAdd.length && (
                      <Check className='h-[16px] w-[16px] text-[var(--accent)]' />
                    )}
                  </button>
                  {availableMembersToAdd.map((member: any) => {
                    const name = member.user?.name || 'Unknown'
                    const email = member.user?.email || ''
                    const avatarInitial = name.charAt(0).toUpperCase()
                    const isSelected = selectedMemberIds.has(member.userId)

                    return (
                      <button
                        key={member.userId}
                        type='button'
                        onClick={() => {
                          setSelectedMemberIds((prev) => {
                            const next = new Set(prev)
                            if (isSelected) {
                              next.delete(member.userId)
                            } else {
                              next.add(member.userId)
                            }
                            return next
                          })
                        }}
                        className={cn(
                          'flex items-center gap-[12px] rounded-[8px] border p-[12px] transition-colors',
                          isSelected
                            ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                            : 'border-[var(--border)] hover:bg-[var(--surface-5)]'
                        )}
                      >
                        <Avatar size='sm'>
                          {member.user?.image && <AvatarImage src={member.user.image} alt={name} />}
                          <AvatarFallback
                            style={{ background: getUserColor(member.userId || email) }}
                            className='border-0 text-white'
                          >
                            {avatarInitial}
                          </AvatarFallback>
                        </Avatar>
                        <div className='min-w-0 flex-1 text-left'>
                          <div className='truncate font-medium text-[14px] text-[var(--text-primary)]'>
                            {name}
                          </div>
                          <div className='truncate text-[12px] text-[var(--text-muted)]'>
                            {email}
                          </div>
                        </div>
                        {isSelected && <Check className='h-[16px] w-[16px] text-[var(--accent)]' />}
                      </button>
                    )
                  })}
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant='default' onClick={() => setShowAddMembersModal(false)}>
                Cancel
              </Button>
              <Button
                variant='tertiary'
                onClick={handleAddSelectedMembers}
                disabled={selectedMemberIds.size === 0 || bulkAddMembers.isPending}
              >
                {bulkAddMembers.isPending
                  ? 'Adding...'
                  : `Add ${selectedMemberIds.size} Member${selectedMemberIds.size !== 1 ? 's' : ''}`}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </>
    )
  }

  return (
    <>
      <div className='flex h-full flex-col gap-[16px]'>
        <div className='flex items-center gap-[8px]'>
          <div className='flex flex-1 items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px] transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover:border-[var(--border-1)] dark:hover:bg-[var(--surface-5)]'>
            <Search
              className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
              strokeWidth={2}
            />
            <BaseInput
              placeholder='Search permission groups...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
          <Button variant='tertiary' onClick={() => setShowCreateModal(true)}>
            <Plus className='mr-[6px] h-[13px] w-[13px]' />
            Create
          </Button>
        </div>

        <div className='relative min-h-0 flex-1 overflow-y-auto'>
          {filteredGroups.length === 0 && searchTerm.trim() ? (
            <div className='py-[16px] text-center text-[13px] text-[var(--text-muted)]'>
              No results found matching "{searchTerm}"
            </div>
          ) : permissionGroups.length === 0 ? (
            <div className='text-[13px] text-[var(--text-muted)]'>
              No permission groups created yet
            </div>
          ) : (
            <div className='flex flex-col gap-[8px]'>
              {filteredGroups.map((group) => (
                <div key={group.id} className='flex items-center justify-between'>
                  <div className='flex flex-col'>
                    <span className='font-medium text-[14px]'>{group.name}</span>
                    <span className='text-[13px] text-[var(--text-muted)]'>
                      {group.memberCount} member{group.memberCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className='flex items-center gap-[8px]'>
                    <Button variant='ghost' onClick={() => setViewingGroup(group)}>
                      Details
                    </Button>
                    <Button
                      variant='destructive'
                      onClick={() => handleDeleteClick(group)}
                      disabled={deletingGroupIds.has(group.id)}
                    >
                      {deletingGroupIds.has(group.id) ? 'Deleting...' : 'Delete'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal open={showCreateModal} onOpenChange={handleCloseCreateModal}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Create Permission Group</ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-[12px]'>
              <div className='flex flex-col gap-[4px]'>
                <Label>Name</Label>
                <Input
                  value={newGroupName}
                  onChange={(e) => {
                    setNewGroupName(e.target.value)
                    if (createError) setCreateError(null)
                  }}
                  placeholder='e.g., Marketing Team'
                />
              </div>
              <div className='flex flex-col gap-[4px]'>
                <Label>Description (optional)</Label>
                <Input
                  value={newGroupDescription}
                  onChange={(e) => setNewGroupDescription(e.target.value)}
                  placeholder='e.g., Limited access for marketing users'
                />
              </div>
              {createError && <p className='text-[12px] text-[var(--text-error)]'>{createError}</p>}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={handleCloseCreateModal}>
              Cancel
            </Button>
            <Button
              variant='tertiary'
              onClick={handleCreatePermissionGroup}
              disabled={!newGroupName.trim() || createPermissionGroup.isPending}
            >
              {createPermissionGroup.isPending ? 'Creating...' : 'Create'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={!!deletingGroup} onOpenChange={() => setDeletingGroup(null)}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Delete Permission Group</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>{deletingGroup?.name}</span>?
              All members will be removed from this group.{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setDeletingGroup(null)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={confirmDelete}
              disabled={deletePermissionGroup.isPending}
            >
              {deletePermissionGroup.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
