'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Plus, Search } from 'lucide-react'
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
  ModalTabs,
  ModalTabsContent,
  ModalTabsList,
  ModalTabsTrigger,
  Switch,
} from '@/components/emcn'
import { Input as BaseInput, Skeleton } from '@/components/ui'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionStatus } from '@/lib/billing/client'
import type { PermissionGroupConfig } from '@/lib/permission-groups/types'
import { getUserColor } from '@/lib/workspaces/colors'
import { getUserRole } from '@/lib/workspaces/organization'
import { getAllBlocks } from '@/blocks'
import {
  type PermissionGroup,
  useBulkAddPermissionGroupMembers,
  useCreatePermissionGroup,
  useDeletePermissionGroup,
  usePermissionGroupMembers,
  usePermissionGroups,
  useRemovePermissionGroupMember,
  useUpdatePermissionGroup,
} from '@/ee/access-control/hooks/permission-groups'
import { useOrganization, useOrganizations } from '@/hooks/queries/organization'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import { PROVIDER_DEFINITIONS } from '@/providers/models'
import { getAllProviderIds } from '@/providers/utils'

const logger = createLogger('AccessControl')

interface AddMembersModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  availableMembers: any[]
  selectedMemberIds: Set<string>
  setSelectedMemberIds: React.Dispatch<React.SetStateAction<Set<string>>>
  onAddMembers: () => void
  isAdding: boolean
}

function AddMembersModal({
  open,
  onOpenChange,
  availableMembers,
  selectedMemberIds,
  setSelectedMemberIds,
  onAddMembers,
  isAdding,
}: AddMembersModalProps) {
  const [searchTerm, setSearchTerm] = useState('')

  const filteredMembers = useMemo(() => {
    if (!searchTerm.trim()) return availableMembers
    const query = searchTerm.toLowerCase()
    return availableMembers.filter((m: any) => {
      const name = m.user?.name || ''
      const email = m.user?.email || ''
      return name.toLowerCase().includes(query) || email.toLowerCase().includes(query)
    })
  }, [availableMembers, searchTerm])

  const allFilteredSelected = useMemo(() => {
    if (filteredMembers.length === 0) return false
    return filteredMembers.every((m: any) => selectedMemberIds.has(m.userId))
  }, [filteredMembers, selectedMemberIds])

  const handleToggleAll = () => {
    if (allFilteredSelected) {
      const filteredIds = new Set(filteredMembers.map((m: any) => m.userId))
      setSelectedMemberIds((prev) => {
        const next = new Set(prev)
        filteredIds.forEach((id) => next.delete(id))
        return next
      })
    } else {
      setSelectedMemberIds((prev) => {
        const next = new Set(prev)
        filteredMembers.forEach((m: any) => next.add(m.userId))
        return next
      })
    }
  }

  const handleToggleMember = (userId: string) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) setSearchTerm('')
        onOpenChange(o)
      }}
    >
      <ModalContent className='w-[420px]'>
        <ModalHeader>Add Members</ModalHeader>
        <ModalBody className='!pb-[16px]'>
          {availableMembers.length === 0 ? (
            <p className='text-[13px] text-[var(--text-muted)]'>
              All organization members are already in this group.
            </p>
          ) : (
            <div className='flex flex-col gap-[12px]'>
              <div className='flex items-center gap-[8px]'>
                <div className='flex flex-1 items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px]'>
                  <Search className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]' />
                  <BaseInput
                    placeholder='Search members...'
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className='h-auto flex-1 border-0 bg-transparent p-0 font-base text-[13px] leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
                  />
                </div>
                <Button variant='tertiary' onClick={handleToggleAll}>
                  {allFilteredSelected ? 'Deselect All' : 'Select All'}
                </Button>
              </div>

              <div className='max-h-[280px] overflow-y-auto'>
                {filteredMembers.length === 0 ? (
                  <p className='py-[16px] text-center text-[13px] text-[var(--text-muted)]'>
                    No members found matching "{searchTerm}"
                  </p>
                ) : (
                  <div className='flex flex-col'>
                    {filteredMembers.map((member: any) => {
                      const name = member.user?.name || 'Unknown'
                      const email = member.user?.email || ''
                      const avatarInitial = name.charAt(0).toUpperCase()
                      const isSelected = selectedMemberIds.has(member.userId)

                      return (
                        <button
                          key={member.userId}
                          type='button'
                          onClick={() => handleToggleMember(member.userId)}
                          className='flex items-center gap-[10px] rounded-[4px] px-[8px] py-[6px] hover:bg-[var(--surface-2)]'
                        >
                          <Checkbox checked={isSelected} />
                          <Avatar size='sm'>
                            {member.user?.image && (
                              <AvatarImage src={member.user.image} alt={name} />
                            )}
                            <AvatarFallback
                              style={{ background: getUserColor(member.userId || email) }}
                              className='border-0 text-[10px] text-white'
                            >
                              {avatarInitial}
                            </AvatarFallback>
                          </Avatar>
                          <div className='min-w-0 flex-1 text-left'>
                            <div className='truncate text-[13px] text-[var(--text-primary)]'>
                              {name}
                            </div>
                            <div className='truncate text-[11px] text-[var(--text-muted)]'>
                              {email}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant='default'
            onClick={() => {
              setSearchTerm('')
              onOpenChange(false)
            }}
          >
            Cancel
          </Button>
          <Button
            variant='tertiary'
            onClick={onAddMembers}
            disabled={selectedMemberIds.size === 0 || isAdding}
          >
            {isAdding ? 'Adding...' : 'Add Members'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

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
  const [newGroupAutoAdd, setNewGroupAutoAdd] = useState(false)
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
  const [platformSearchTerm, setPlatformSearchTerm] = useState('')
  const [showUnsavedChanges, setShowUnsavedChanges] = useState(false)

  const platformFeatures = useMemo(
    () => [
      {
        id: 'hide-knowledge-base',
        label: 'Knowledge Base',
        category: 'Sidebar',
        configKey: 'hideKnowledgeBaseTab' as const,
      },
      {
        id: 'hide-templates',
        label: 'Templates',
        category: 'Sidebar',
        configKey: 'hideTemplates' as const,
      },
      {
        id: 'hide-copilot',
        label: 'Copilot',
        category: 'Workflow Panel',
        configKey: 'hideCopilot' as const,
      },
      {
        id: 'hide-api-keys',
        label: 'API Keys',
        category: 'Settings Tabs',
        configKey: 'hideApiKeysTab' as const,
      },
      {
        id: 'hide-environment',
        label: 'Environment',
        category: 'Settings Tabs',
        configKey: 'hideEnvironmentTab' as const,
      },
      {
        id: 'hide-files',
        label: 'Files',
        category: 'Settings Tabs',
        configKey: 'hideFilesTab' as const,
      },
      {
        id: 'hide-deploy-api',
        label: 'API',
        category: 'Deploy Tabs',
        configKey: 'hideDeployApi' as const,
      },
      {
        id: 'hide-deploy-mcp',
        label: 'MCP',
        category: 'Deploy Tabs',
        configKey: 'hideDeployMcp' as const,
      },
      {
        id: 'hide-deploy-a2a',
        label: 'A2A',
        category: 'Deploy Tabs',
        configKey: 'hideDeployA2a' as const,
      },
      {
        id: 'hide-deploy-chatbot',
        label: 'Chat',
        category: 'Deploy Tabs',
        configKey: 'hideDeployChatbot' as const,
      },
      {
        id: 'hide-deploy-template',
        label: 'Template',
        category: 'Deploy Tabs',
        configKey: 'hideDeployTemplate' as const,
      },
      {
        id: 'disable-mcp',
        label: 'MCP Tools',
        category: 'Tools',
        configKey: 'disableMcpTools' as const,
      },
      {
        id: 'disable-custom-tools',
        label: 'Custom Tools',
        category: 'Tools',
        configKey: 'disableCustomTools' as const,
      },
      {
        id: 'disable-skills',
        label: 'Skills',
        category: 'Tools',
        configKey: 'disableSkills' as const,
      },
      {
        id: 'hide-trace-spans',
        label: 'Trace Spans',
        category: 'Logs',
        configKey: 'hideTraceSpans' as const,
      },
      {
        id: 'disable-invitations',
        label: 'Invitations',
        category: 'Collaboration',
        configKey: 'disableInvitations' as const,
      },
    ],
    []
  )

  const filteredPlatformFeatures = useMemo(() => {
    if (!platformSearchTerm.trim()) return platformFeatures
    const search = platformSearchTerm.toLowerCase()
    return platformFeatures.filter(
      (f) => f.label.toLowerCase().includes(search) || f.category.toLowerCase().includes(search)
    )
  }, [platformFeatures, platformSearchTerm])

  const platformCategories = useMemo(() => {
    const categories: Record<string, typeof platformFeatures> = {}
    for (const feature of filteredPlatformFeatures) {
      if (!categories[feature.category]) {
        categories[feature.category] = []
      }
      categories[feature.category].push(feature)
    }
    return categories
  }, [filteredPlatformFeatures])

  const hasConfigChanges = useMemo(() => {
    if (!viewingGroup || !editingConfig) return false
    const original = viewingGroup.config
    return JSON.stringify(original) !== JSON.stringify(editingConfig)
  }, [viewingGroup, editingConfig])

  const allBlocks = useMemo(() => {
    const blocks = getAllBlocks().filter((b) => !b.hideFromToolbar && b.type !== 'start_trigger')
    return blocks.sort((a, b) => {
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
      await createPermissionGroup.mutateAsync({
        organizationId: activeOrganization.id,
        name: newGroupName.trim(),
        description: newGroupDescription.trim() || undefined,
        autoAddNewMembers: newGroupAutoAdd,
      })
      setShowCreateModal(false)
      setNewGroupName('')
      setNewGroupDescription('')
      setNewGroupAutoAdd(false)
    } catch (error) {
      logger.error('Failed to create permission group', error)
      if (error instanceof Error) {
        setCreateError(error.message)
      } else {
        setCreateError('Failed to create permission group')
      }
    }
  }, [
    newGroupName,
    newGroupDescription,
    newGroupAutoAdd,
    activeOrganization?.id,
    createPermissionGroup,
  ])

  const handleCloseCreateModal = useCallback(() => {
    setShowCreateModal(false)
    setNewGroupName('')
    setNewGroupDescription('')
    setNewGroupAutoAdd(false)
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
      setPlatformSearchTerm('')
      setViewingGroup((prev) => (prev ? { ...prev, config: editingConfig } : null))
    } catch (error) {
      logger.error('Failed to update config', error)
    }
  }, [viewingGroup, editingConfig, activeOrganization?.id, updatePermissionGroup])

  const handleOpenAddMembersModal = useCallback(() => {
    setSelectedMemberIds(new Set())
    setShowAddMembersModal(true)
  }, [])

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

  const handleToggleAutoAdd = useCallback(
    async (enabled: boolean) => {
      if (!viewingGroup || !activeOrganization?.id) return
      try {
        await updatePermissionGroup.mutateAsync({
          id: viewingGroup.id,
          organizationId: activeOrganization.id,
          autoAddNewMembers: enabled,
        })
        setViewingGroup((prev) => (prev ? { ...prev, autoAddNewMembers: enabled } : null))
      } catch (error) {
        logger.error('Failed to toggle auto-add', error)
      }
    },
    [viewingGroup, activeOrganization?.id, updatePermissionGroup]
  )

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
          <div className='flex flex-col gap-[4px]'>
            <div className='flex items-center justify-between'>
              <h3 className='font-medium text-[14px] text-[var(--text-primary)]'>
                {viewingGroup.name}
              </h3>
              <Button variant='default' onClick={handleOpenConfigModal}>
                Configure
              </Button>
            </div>
            {viewingGroup.description && (
              <p className='text-[13px] text-[var(--text-muted)]'>{viewingGroup.description}</p>
            )}
          </div>

          <div className='flex items-center justify-between'>
            <div className='flex flex-col gap-[2px]'>
              <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                Auto-add new members
              </span>
              <span className='text-[12px] text-[var(--text-muted)]'>
                Automatically add new organization members to this group
              </span>
            </div>
            <Switch
              checked={viewingGroup.autoAddNewMembers}
              onCheckedChange={(checked) => handleToggleAutoAdd(checked)}
              disabled={updatePermissionGroup.isPending}
            />
          </div>

          <div className='min-h-0 flex-1 overflow-y-auto'>
            <div className='flex flex-col gap-[8px]'>
              <div className='flex items-center justify-between'>
                <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                  Members
                </span>
                <Button variant='tertiary' onClick={handleOpenAddMembersModal}>
                  <Plus className='mr-[6px] h-[13px] w-[13px]' />
                  Add
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
                  No members yet. Click "Add" to get started.
                </p>
              ) : (
                <div className='flex flex-col gap-[16px]'>
                  {members.map((member) => {
                    const name = member.userName || 'Unknown'
                    const avatarInitial = name.charAt(0).toUpperCase()

                    return (
                      <div key={member.id} className='flex items-center justify-between'>
                        <div className='flex flex-1 items-center gap-[12px]'>
                          <Avatar size='md'>
                            {member.userImage && <AvatarImage src={member.userImage} alt={name} />}
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

                        <Button
                          variant='ghost'
                          onClick={() => handleRemoveMember(member.id)}
                          disabled={removeMember.isPending}
                          className='flex-shrink-0'
                        >
                          Remove
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div className='mt-auto flex items-center justify-end'>
            <Button onClick={handleBackToList} variant='tertiary'>
              Back
            </Button>
          </div>
        </div>

        <Modal
          open={showConfigModal}
          onOpenChange={(open) => {
            if (!open && hasConfigChanges) {
              setShowUnsavedChanges(true)
            } else {
              setShowConfigModal(open)
              if (!open) {
                setProviderSearchTerm('')
                setIntegrationSearchTerm('')
                setPlatformSearchTerm('')
              }
            }
          }}
        >
          <ModalContent size='xl' className='max-h-[80vh]'>
            <ModalHeader>Configure Permissions</ModalHeader>
            <ModalTabs defaultValue='providers'>
              <ModalTabsList>
                <ModalTabsTrigger value='providers'>Model Providers</ModalTabsTrigger>
                <ModalTabsTrigger value='blocks'>Blocks</ModalTabsTrigger>
                <ModalTabsTrigger value='platform'>Platform</ModalTabsTrigger>
              </ModalTabsList>

              <ModalTabsContent value='providers'>
                <ModalBody className='h-[400px]'>
                  <div className='flex flex-col gap-[8px]'>
                    <div className='flex items-center gap-[8px]'>
                      <div className='flex flex-1 items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px]'>
                        <Search className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]' />
                        <BaseInput
                          placeholder='Search providers...'
                          value={providerSearchTerm}
                          onChange={(e) => setProviderSearchTerm(e.target.value)}
                          className='h-auto flex-1 border-0 bg-transparent p-0 font-base text-[13px] leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
                        />
                      </div>
                      <Button
                        variant='tertiary'
                        onClick={() => {
                          const allAllowed =
                            editingConfig?.allowedModelProviders === null ||
                            editingConfig?.allowedModelProviders?.length === allProviderIds.length
                          setEditingConfig((prev) =>
                            prev ? { ...prev, allowedModelProviders: allAllowed ? [] : null } : prev
                          )
                        }}
                      >
                        {editingConfig?.allowedModelProviders === null ||
                        editingConfig?.allowedModelProviders?.length === allProviderIds.length
                          ? 'Deselect All'
                          : 'Select All'}
                      </Button>
                    </div>
                    <div className='grid max-h-[340px] grid-cols-3 gap-[8px] overflow-y-auto'>
                      {filteredProviders.map((providerId) => {
                        const ProviderIcon = PROVIDER_DEFINITIONS[providerId]?.icon
                        const providerName =
                          PROVIDER_DEFINITIONS[providerId]?.name ||
                          providerId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
                        return (
                          <div key={providerId} className='flex items-center gap-[8px]'>
                            <Checkbox
                              checked={isProviderAllowed(providerId)}
                              onCheckedChange={() => toggleProvider(providerId)}
                            />
                            <div className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
                              {ProviderIcon && <ProviderIcon className='!h-[16px] !w-[16px]' />}
                            </div>
                            <span className='truncate font-medium text-[13px]'>{providerName}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </ModalBody>
              </ModalTabsContent>

              <ModalTabsContent value='blocks'>
                <ModalBody className='h-[400px]'>
                  <div className='flex flex-col gap-[8px]'>
                    <div className='flex items-center gap-[8px]'>
                      <div className='flex flex-1 items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px]'>
                        <Search className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]' />
                        <BaseInput
                          placeholder='Search blocks...'
                          value={integrationSearchTerm}
                          onChange={(e) => setIntegrationSearchTerm(e.target.value)}
                          className='h-auto flex-1 border-0 bg-transparent p-0 font-base text-[13px] leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
                        />
                      </div>
                      <Button
                        variant='tertiary'
                        onClick={() => {
                          const allAllowed =
                            editingConfig?.allowedIntegrations === null ||
                            editingConfig?.allowedIntegrations?.length === allBlocks.length
                          setEditingConfig((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  allowedIntegrations: allAllowed ? ['start_trigger'] : null,
                                }
                              : prev
                          )
                        }}
                      >
                        {editingConfig?.allowedIntegrations === null ||
                        editingConfig?.allowedIntegrations?.length === allBlocks.length
                          ? 'Deselect All'
                          : 'Select All'}
                      </Button>
                    </div>
                    <div className='grid max-h-[340px] grid-cols-3 gap-[8px] overflow-y-auto'>
                      {filteredBlocks.map((block) => {
                        const BlockIcon = block.icon
                        return (
                          <div key={block.type} className='flex items-center gap-[8px]'>
                            <Checkbox
                              checked={isIntegrationAllowed(block.type)}
                              onCheckedChange={() => toggleIntegration(block.type)}
                            />
                            <div
                              className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
                              style={{ background: block.bgColor }}
                            >
                              {BlockIcon && (
                                <BlockIcon className='!h-[10px] !w-[10px] text-white' />
                              )}
                            </div>
                            <span className='truncate font-medium text-[13px]'>{block.name}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </ModalBody>
              </ModalTabsContent>

              <ModalTabsContent value='platform'>
                <ModalBody className='h-[400px]'>
                  <div className='flex flex-col gap-[8px]'>
                    <div className='flex items-center gap-[8px]'>
                      <div className='flex flex-1 items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px]'>
                        <Search className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]' />
                        <BaseInput
                          placeholder='Search features...'
                          value={platformSearchTerm}
                          onChange={(e) => setPlatformSearchTerm(e.target.value)}
                          className='h-auto flex-1 border-0 bg-transparent p-0 font-base text-[13px] leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
                        />
                      </div>
                      <Button
                        variant='tertiary'
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
                            !editingConfig?.disableSkills &&
                            !editingConfig?.hideTraceSpans &&
                            !editingConfig?.disableInvitations &&
                            !editingConfig?.hideDeployApi &&
                            !editingConfig?.hideDeployMcp &&
                            !editingConfig?.hideDeployA2a &&
                            !editingConfig?.hideDeployChatbot &&
                            !editingConfig?.hideDeployTemplate
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
                                  disableSkills: allVisible,
                                  hideTraceSpans: allVisible,
                                  disableInvitations: allVisible,
                                  hideDeployApi: allVisible,
                                  hideDeployMcp: allVisible,
                                  hideDeployA2a: allVisible,
                                  hideDeployChatbot: allVisible,
                                  hideDeployTemplate: allVisible,
                                }
                              : prev
                          )
                        }}
                      >
                        {!editingConfig?.hideKnowledgeBaseTab &&
                        !editingConfig?.hideTemplates &&
                        !editingConfig?.hideCopilot &&
                        !editingConfig?.hideApiKeysTab &&
                        !editingConfig?.hideEnvironmentTab &&
                        !editingConfig?.hideFilesTab &&
                        !editingConfig?.disableMcpTools &&
                        !editingConfig?.disableCustomTools &&
                        !editingConfig?.disableSkills &&
                        !editingConfig?.hideTraceSpans &&
                        !editingConfig?.disableInvitations &&
                        !editingConfig?.hideDeployApi &&
                        !editingConfig?.hideDeployMcp &&
                        !editingConfig?.hideDeployA2a &&
                        !editingConfig?.hideDeployChatbot &&
                        !editingConfig?.hideDeployTemplate
                          ? 'Deselect All'
                          : 'Select All'}
                      </Button>
                    </div>
                    <div className='grid max-h-[340px] grid-cols-3 gap-x-[24px] gap-y-[16px] overflow-y-auto'>
                      {Object.entries(platformCategories).map(([category, features]) => (
                        <div key={category} className='flex flex-col gap-[8px]'>
                          <span className='font-medium text-[11px] text-[var(--text-tertiary)] uppercase tracking-wide'>
                            {category}
                          </span>
                          <div className='flex flex-col gap-[8px]'>
                            {features.map((feature) => (
                              <div key={feature.id} className='flex items-center gap-[8px]'>
                                <Checkbox
                                  id={feature.id}
                                  checked={!editingConfig?.[feature.configKey]}
                                  onCheckedChange={(checked) =>
                                    setEditingConfig((prev) =>
                                      prev
                                        ? { ...prev, [feature.configKey]: checked !== true }
                                        : prev
                                    )
                                  }
                                />
                                <Label
                                  htmlFor={feature.id}
                                  className='cursor-pointer font-normal text-[13px]'
                                >
                                  {feature.label}
                                </Label>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </ModalBody>
              </ModalTabsContent>
            </ModalTabs>
            <ModalFooter>
              <Button
                variant='default'
                onClick={() => {
                  if (hasConfigChanges) {
                    setShowUnsavedChanges(true)
                  } else {
                    setShowConfigModal(false)
                    setProviderSearchTerm('')
                    setIntegrationSearchTerm('')
                    setPlatformSearchTerm('')
                  }
                }}
              >
                Cancel
              </Button>
              <Button
                variant='tertiary'
                onClick={handleSaveConfig}
                disabled={updatePermissionGroup.isPending || !hasConfigChanges}
              >
                {updatePermissionGroup.isPending ? 'Saving...' : 'Save'}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        <Modal open={showUnsavedChanges} onOpenChange={setShowUnsavedChanges}>
          <ModalContent size='sm'>
            <ModalHeader>Unsaved Changes</ModalHeader>
            <ModalBody>
              <p className='text-[12px] text-[var(--text-secondary)]'>
                You have unsaved changes. Do you want to save them before closing?
              </p>
            </ModalBody>
            <ModalFooter>
              <Button
                variant='destructive'
                onClick={() => {
                  setShowUnsavedChanges(false)
                  setShowConfigModal(false)
                  setEditingConfig(null)
                  setProviderSearchTerm('')
                  setIntegrationSearchTerm('')
                  setPlatformSearchTerm('')
                }}
              >
                Discard Changes
              </Button>
              <Button
                variant='tertiary'
                onClick={() => {
                  setShowUnsavedChanges(false)
                  handleSaveConfig()
                }}
                disabled={updatePermissionGroup.isPending}
              >
                {updatePermissionGroup.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        <AddMembersModal
          open={showAddMembersModal}
          onOpenChange={setShowAddMembersModal}
          availableMembers={availableMembersToAdd}
          selectedMemberIds={selectedMemberIds}
          setSelectedMemberIds={setSelectedMemberIds}
          onAddMembers={handleAddSelectedMembers}
          isAdding={bulkAddMembers.isPending}
        />
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
            <div className='flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]'>
              Click "Create" above to get started
            </div>
          ) : (
            <div className='flex flex-col gap-[8px]'>
              {filteredGroups.map((group) => (
                <div key={group.id} className='flex items-center justify-between'>
                  <div className='flex flex-col'>
                    <div className='flex items-center gap-[8px]'>
                      <span className='font-medium text-[14px]'>{group.name}</span>
                      {group.autoAddNewMembers && (
                        <span className='rounded-[4px] bg-[var(--surface-3)] px-[6px] py-[2px] text-[10px] text-[var(--text-muted)]'>
                          Auto-enrolls
                        </span>
                      )}
                    </div>
                    <span className='text-[13px] text-[var(--text-muted)]'>
                      {group.memberCount} member{group.memberCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className='flex flex-shrink-0 items-center gap-[8px]'>
                    <Button variant='default' onClick={() => setViewingGroup(group)}>
                      Details
                    </Button>
                    <Button
                      variant='ghost'
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
        <ModalContent size='sm'>
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
              <div className='flex items-center gap-[8px]'>
                <Checkbox
                  id='auto-add-members'
                  checked={newGroupAutoAdd}
                  onCheckedChange={(checked) => setNewGroupAutoAdd(checked === true)}
                />
                <Label htmlFor='auto-add-members' className='cursor-pointer font-normal'>
                  Auto-add new organization members
                </Label>
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
        <ModalContent size='sm'>
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
