'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ArrowRight, ChevronDown, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Checkbox,
  Chip,
  ChipConfirmModal,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipModalTabs,
  Label,
  Search,
  Skeleton,
  Switch,
} from '@/components/emcn'
import { ArrowLeft } from '@/components/emcn/icons'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { cn } from '@/lib/core/utils/cn'
import type { PermissionGroupConfig } from '@/lib/permission-groups/types'
import { getUserColor } from '@/lib/workspaces/colors'
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
  useUserPermissionConfig,
} from '@/ee/access-control/hooks/permission-groups'
import { useBlacklistedProviders } from '@/hooks/queries/allowed-providers'
import { useProviderModels } from '@/hooks/queries/providers'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import {
  DYNAMIC_MODEL_PROVIDERS,
  getProviderModels,
  PROVIDER_DEFINITIONS,
} from '@/providers/models'
import type { ProviderId } from '@/providers/types'
import { getAllProviderIds, getProviderFromModel } from '@/providers/utils'
import type { ProviderName } from '@/stores/providers'

const logger = createLogger('AccessControl')

interface WorkspaceMemberOption {
  userId: string
  user: {
    name: string | null
    email: string
    image?: string | null
  }
}

interface AddMembersModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  availableMembers: WorkspaceMemberOption[]
  selectedMemberIds: Set<string>
  setSelectedMemberIds: React.Dispatch<React.SetStateAction<Set<string>>>
  onAddMembers: () => void
  isAdding: boolean
  errorMessage: string | null
}

function AddMembersModal({
  open,
  onOpenChange,
  availableMembers,
  selectedMemberIds,
  setSelectedMemberIds,
  onAddMembers,
  isAdding,
  errorMessage,
}: AddMembersModalProps) {
  const [searchTerm, setSearchTerm] = useState('')

  const filteredMembers = useMemo(() => {
    if (!searchTerm.trim()) return availableMembers
    const query = searchTerm.toLowerCase()
    return availableMembers.filter((m) => {
      const name = m.user?.name || ''
      const email = m.user?.email || ''
      return name.toLowerCase().includes(query) || email.toLowerCase().includes(query)
    })
  }, [availableMembers, searchTerm])

  const allFilteredSelected = useMemo(() => {
    if (filteredMembers.length === 0) return false
    return filteredMembers.every((m) => selectedMemberIds.has(m.userId))
  }, [filteredMembers, selectedMemberIds])

  const handleToggleAll = () => {
    if (allFilteredSelected) {
      const filteredIds = new Set(filteredMembers.map((m) => m.userId))
      setSelectedMemberIds((prev) => {
        const next = new Set(prev)
        filteredIds.forEach((id) => next.delete(id))
        return next
      })
    } else {
      setSelectedMemberIds((prev) => {
        const next = new Set(prev)
        filteredMembers.forEach((m) => next.add(m.userId))
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
    <ChipModal
      open={open}
      onOpenChange={(o) => {
        if (!o) setSearchTerm('')
        onOpenChange(o)
      }}
      size='sm'
      srTitle='Add Members'
    >
      <ChipModalHeader onClose={() => onOpenChange(false)}>Add Members</ChipModalHeader>
      <ChipModalBody>
        {availableMembers.length === 0 ? (
          <p className='px-2 text-[var(--text-muted)] text-sm'>
            All workspace members are already in this group.
          </p>
        ) : (
          <ChipModalField type='custom' title='Members'>
            <div className='flex flex-col gap-3'>
              <div className='flex items-center gap-2'>
                <ChipInput
                  icon={Search}
                  placeholder='Search members...'
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className='min-w-0 flex-1'
                />
                <Chip onClick={handleToggleAll}>
                  {allFilteredSelected ? 'Deselect All' : 'Select All'}
                </Chip>
              </div>

              <div className='max-h-[280px] overflow-y-auto'>
                {filteredMembers.length === 0 ? (
                  <p className='py-4 text-center text-[var(--text-muted)] text-sm'>
                    No members found matching "{searchTerm}"
                  </p>
                ) : (
                  <div className='flex flex-col'>
                    {filteredMembers.map((member) => {
                      const name = member.user?.name || 'Unknown'
                      const email = member.user?.email || ''
                      const avatarInitial = name.charAt(0).toUpperCase()
                      const isSelected = selectedMemberIds.has(member.userId)

                      return (
                        <button
                          key={member.userId}
                          type='button'
                          onClick={() => handleToggleMember(member.userId)}
                          className='flex items-center gap-2.5 rounded-sm px-2 py-1.5 hover-hover:bg-[var(--surface-active)]'
                        >
                          <Checkbox checked={isSelected} />
                          <Avatar size='sm'>
                            {member.user?.image && (
                              <AvatarImage src={member.user.image} alt={name} />
                            )}
                            <AvatarFallback
                              style={{ background: getUserColor(member.userId || email) }}
                              className='border-0 text-micro text-white'
                            >
                              {avatarInitial}
                            </AvatarFallback>
                          </Avatar>
                          <div className='min-w-0 flex-1 text-left'>
                            <div className='truncate text-[var(--text-body)] text-sm'>{name}</div>
                            <div className='truncate text-[var(--text-muted)] text-xs'>{email}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </ChipModalField>
        )}
        <ChipModalError>{errorMessage}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => {
          setSearchTerm('')
          onOpenChange(false)
        }}
        primaryAction={{
          label: isAdding ? 'Adding...' : 'Add Members',
          onClick: onAddMembers,
          disabled: selectedMemberIds.size === 0 || isAdding,
        }}
      />
    </ChipModal>
  )
}

interface ModelDenylistControls {
  isModelAllowed: (model: string) => boolean
  onToggleModel: (model: string) => void
  onSetModelsDenied: (models: string[], denied: boolean) => void
}

interface ModelCheckboxGridProps extends ModelDenylistControls {
  models: string[]
  isLoading: boolean
}

function ModelCheckboxGrid({
  models,
  isLoading,
  isModelAllowed,
  onToggleModel,
  onSetModelsDenied,
}: ModelCheckboxGridProps) {
  const [search, setSearch] = useState('')

  const sortedModels = useMemo(() => [...models].sort((a, b) => a.localeCompare(b)), [models])

  const filteredModels = useMemo(() => {
    if (!search.trim()) return sortedModels
    const query = search.toLowerCase()
    return sortedModels.filter((model) => model.toLowerCase().includes(query))
  }, [sortedModels, search])

  if (isLoading) {
    return <div className='px-2 py-3 text-[var(--text-muted)] text-xs'>Loading models…</div>
  }

  if (models.length === 0) {
    return (
      <div className='px-2 py-3 text-[var(--text-muted)] text-xs'>
        No models available for this provider.
      </div>
    )
  }

  const allFilteredAllowed = filteredModels.every((model) => isModelAllowed(model))

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center gap-2'>
        <ChipInput
          icon={Search}
          placeholder='Search models...'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='min-w-0 flex-1'
        />
        <Chip onClick={() => onSetModelsDenied(filteredModels, allFilteredAllowed)}>
          {allFilteredAllowed ? 'Block All' : 'Allow All'}
        </Chip>
      </div>
      <div className='grid grid-cols-2 gap-x-2 gap-y-0.5'>
        {filteredModels.map((model) => {
          const checkboxId = `model-${model}`
          return (
            <label
              key={model}
              htmlFor={checkboxId}
              className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-[5px] transition-colors hover-hover:bg-[var(--surface-active)]'
            >
              <Checkbox
                id={checkboxId}
                checked={isModelAllowed(model)}
                onCheckedChange={() => onToggleModel(model)}
              />
              <span className='truncate text-sm'>{model}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

interface DynamicProviderModelsProps extends ModelDenylistControls {
  provider: ProviderName
  workspaceId?: string
}

function DynamicProviderModels({ provider, workspaceId, ...controls }: DynamicProviderModelsProps) {
  const { data, isPending } = useProviderModels(provider, workspaceId)
  return <ModelCheckboxGrid models={data?.models ?? []} isLoading={isPending} {...controls} />
}

interface StaticProviderModelsProps extends ModelDenylistControls {
  providerId: ProviderId
}

function StaticProviderModels({ providerId, ...controls }: StaticProviderModelsProps) {
  const models = useMemo(() => getProviderModels(providerId), [providerId])
  return <ModelCheckboxGrid models={models} isLoading={false} {...controls} />
}

interface ProviderRowProps extends ModelDenylistControls {
  providerId: ProviderId
  isProviderAllowed: boolean
  onToggleProvider: () => void
  deniedCount: number
  workspaceId?: string
}

function ProviderRow({
  providerId,
  isProviderAllowed,
  onToggleProvider,
  deniedCount,
  workspaceId,
  ...controls
}: ProviderRowProps) {
  const [expanded, setExpanded] = useState(false)

  const ProviderIcon = PROVIDER_DEFINITIONS[providerId]?.icon
  const providerName =
    PROVIDER_DEFINITIONS[providerId]?.name ||
    providerId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const isDynamic = (DYNAMIC_MODEL_PROVIDERS as readonly string[]).includes(providerId)
  const checkboxId = `provider-${providerId}`

  return (
    <div>
      <div className='flex items-center gap-2 rounded-md px-2 py-[5px] transition-colors hover-hover:bg-[var(--surface-active)]'>
        <Checkbox
          id={checkboxId}
          checked={isProviderAllowed}
          onCheckedChange={() => onToggleProvider()}
        />
        <div className='relative flex size-[16px] flex-shrink-0 items-center justify-center'>
          {ProviderIcon && <ProviderIcon className='!h-[16px] !w-[16px]' />}
        </div>
        <button
          type='button'
          onClick={() => isProviderAllowed && setExpanded((prev) => !prev)}
          disabled={!isProviderAllowed}
          className={cn(
            'flex flex-1 items-center gap-2 text-left',
            isProviderAllowed ? 'cursor-pointer' : 'cursor-default opacity-60'
          )}
        >
          <span className='truncate font-medium text-sm'>{providerName}</span>
          {isProviderAllowed && deniedCount > 0 && (
            <span className='rounded-sm bg-[var(--surface-3)] px-1.5 py-0.5 text-[var(--text-muted)] text-micro'>
              {deniedCount} blocked
            </span>
          )}
          {isProviderAllowed && (
            <ChevronDown
              className={cn(
                'ml-auto size-[14px] flex-shrink-0 text-[var(--text-tertiary)] transition-transform',
                expanded && 'rotate-180'
              )}
            />
          )}
        </button>
      </div>
      {expanded && isProviderAllowed && (
        <div className='border-[var(--border)] border-t px-2 pt-2 pb-3'>
          {isDynamic ? (
            <DynamicProviderModels
              provider={providerId as ProviderName}
              workspaceId={workspaceId}
              {...controls}
            />
          ) : (
            <StaticProviderModels providerId={providerId} {...controls} />
          )}
        </div>
      )}
    </div>
  )
}

export function AccessControl() {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : undefined

  const { data: permissionGroups = [], isPending: groupsLoading } = usePermissionGroups(
    workspaceId,
    !!workspaceId
  )
  const { data: workspacePermissionsData, isPending: permsLoading } = useWorkspacePermissionsQuery(
    workspaceId ?? null
  )
  const { data: userPermissionConfig, isPending: entitlementLoading } =
    useUserPermissionConfig(workspaceId)

  const currentUserIsWorkspaceAdmin = workspacePermissionsData?.viewer?.isAdmin ?? false

  const accessControlEnabledLocally = isTruthy(getEnv('NEXT_PUBLIC_ACCESS_CONTROL_ENABLED'))
  const isEntitled = accessControlEnabledLocally || !!userPermissionConfig?.entitled
  const canManage = isEntitled && currentUserIsWorkspaceAdmin

  const isLoading = !workspaceId || groupsLoading || permsLoading || entitlementLoading

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
  const [deletingGroupIds, setDeletingGroupIds] = useState<Set<string>>(() => new Set())

  const { data: members = [], isPending: membersLoading } = usePermissionGroupMembers(
    workspaceId,
    viewingGroup?.id
  )
  const removeMember = useRemovePermissionGroupMember()

  const [showConfigModal, setShowConfigModal] = useState(false)
  const [configTab, setConfigTab] = useState<'providers' | 'blocks' | 'platform'>('providers')
  const [editingConfig, setEditingConfig] = useState<PermissionGroupConfig | null>(null)
  const [showAddMembersModal, setShowAddMembersModal] = useState(false)
  const [addMembersError, setAddMembersError] = useState<string | null>(null)
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(() => new Set())
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
        id: 'hide-tables',
        label: 'Tables',
        category: 'Sidebar',
        configKey: 'hideTablesTab' as const,
      },
      {
        id: 'hide-copilot',
        label: 'Copilot',
        category: 'Workflow Panel',
        configKey: 'hideCopilot' as const,
      },
      {
        id: 'hide-integrations',
        label: 'Integrations',
        category: 'Settings Tabs',
        configKey: 'hideIntegrationsTab' as const,
      },
      {
        id: 'hide-secrets',
        label: 'Secrets',
        category: 'Settings Tabs',
        configKey: 'hideSecretsTab' as const,
      },
      {
        id: 'hide-api-keys',
        label: 'API Keys',
        category: 'Settings Tabs',
        configKey: 'hideApiKeysTab' as const,
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
      {
        id: 'hide-inbox',
        label: 'Sim Mailer',
        category: 'Features',
        configKey: 'hideInboxTab' as const,
      },
      {
        id: 'disable-public-api',
        label: 'Public API',
        category: 'Features',
        configKey: 'disablePublicApi' as const,
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

  const platformCategoryColumns = useMemo(() => {
    const categoryGroups = [
      ['Sidebar', 'Deploy Tabs', 'Collaboration'],
      ['Workflow Panel', 'Tools', 'Features'],
      ['Settings Tabs', 'Logs'],
    ]

    const assignedCategories = new Set(categoryGroups.flat())
    const unassigned = Object.keys(platformCategories).filter((c) => !assignedCategories.has(c))
    const groups = unassigned.length > 0 ? [...categoryGroups, unassigned] : categoryGroups

    return groups
      .map((column) =>
        column
          .map((category) => ({
            category,
            features: platformCategories[category] ?? [],
          }))
          .filter((section) => section.features.length > 0)
      )
      .filter((column) => column.length > 0)
  }, [platformCategories])

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
  const { data: blacklistedProvidersData } = useBlacklistedProviders({ enabled: showConfigModal })

  const allProviderIds = useMemo(() => {
    const allIds = getAllProviderIds()
    const blacklist = blacklistedProvidersData?.blacklistedProviders ?? []
    if (blacklist.length === 0) return allIds
    return allIds.filter((id) => !blacklist.includes(id.toLowerCase()))
  }, [blacklistedProvidersData])

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

  const filteredCoreBlocks = useMemo(() => {
    return filteredBlocks.filter((block) => block.category === 'blocks')
  }, [filteredBlocks])

  const filteredToolBlocks = useMemo(() => {
    return filteredBlocks
      .filter((block) => block.category === 'tools' || block.category === 'triggers')
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [filteredBlocks])

  const workspaceMembers = useMemo<WorkspaceMemberOption[]>(() => {
    if (!workspacePermissionsData) return []
    return workspacePermissionsData.users.map((u) => ({
      userId: u.userId,
      user: {
        name: u.name,
        email: u.email,
        image: u.image,
      },
    }))
  }, [workspacePermissionsData])

  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return permissionGroups
    const searchLower = searchTerm.toLowerCase()
    return permissionGroups.filter((g) => g.name.toLowerCase().includes(searchLower))
  }, [permissionGroups, searchTerm])

  const handleCreatePermissionGroup = useCallback(async () => {
    if (!newGroupName.trim() || !workspaceId) return
    setCreateError(null)
    try {
      await createPermissionGroup.mutateAsync({
        workspaceId,
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
  }, [newGroupName, newGroupDescription, newGroupAutoAdd, workspaceId, createPermissionGroup])

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
    if (!deletingGroup || !workspaceId) return
    setDeletingGroupIds((prev) => new Set(prev).add(deletingGroup.id))
    try {
      await deletePermissionGroup.mutateAsync({
        permissionGroupId: deletingGroup.id,
        workspaceId,
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
  }, [deletingGroup, workspaceId, deletePermissionGroup, viewingGroup?.id])

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
      if (!viewingGroup || !workspaceId) return
      try {
        await removeMember.mutateAsync({
          workspaceId,
          permissionGroupId: viewingGroup.id,
          memberId,
        })
      } catch (error) {
        logger.error('Failed to remove member', error)
      }
    },
    [viewingGroup, workspaceId, removeMember]
  )

  const handleOpenConfigModal = useCallback(() => {
    if (!viewingGroup) return
    setEditingConfig({ ...viewingGroup.config })
    setShowConfigModal(true)
  }, [viewingGroup])

  const handleSaveConfig = useCallback(async () => {
    if (!viewingGroup || !editingConfig || !workspaceId) return
    try {
      await updatePermissionGroup.mutateAsync({
        id: viewingGroup.id,
        workspaceId,
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
  }, [viewingGroup, editingConfig, workspaceId, updatePermissionGroup])

  const handleCloseConfigModal = useCallback(() => {
    if (hasConfigChanges) {
      setShowUnsavedChanges(true)
    } else {
      setShowConfigModal(false)
      setProviderSearchTerm('')
      setIntegrationSearchTerm('')
      setPlatformSearchTerm('')
    }
  }, [hasConfigChanges])

  const handleDiscardConfig = useCallback(() => {
    setShowUnsavedChanges(false)
    setShowConfigModal(false)
    setEditingConfig(null)
    setProviderSearchTerm('')
    setIntegrationSearchTerm('')
    setPlatformSearchTerm('')
  }, [])

  const handleSaveConfigFromUnsaved = useCallback(() => {
    setShowUnsavedChanges(false)
    handleSaveConfig()
  }, [handleSaveConfig])

  const handleOpenAddMembersModal = useCallback(() => {
    setSelectedMemberIds(new Set())
    setAddMembersError(null)
    setShowAddMembersModal(true)
  }, [])

  const handleAddSelectedMembers = useCallback(async () => {
    if (!viewingGroup || !workspaceId || selectedMemberIds.size === 0) return
    setAddMembersError(null)
    try {
      await bulkAddMembers.mutateAsync({
        workspaceId,
        permissionGroupId: viewingGroup.id,
        userIds: Array.from(selectedMemberIds),
      })
      setShowAddMembersModal(false)
      setSelectedMemberIds(new Set())
    } catch (error) {
      logger.error('Failed to add members', error)
      setAddMembersError(
        error instanceof Error && error.message ? error.message : 'Failed to add members'
      )
    }
  }, [viewingGroup, workspaceId, selectedMemberIds, bulkAddMembers])

  const handleToggleAutoAdd = useCallback(
    async (enabled: boolean) => {
      if (!viewingGroup || !workspaceId) return
      try {
        await updatePermissionGroup.mutateAsync({
          id: viewingGroup.id,
          workspaceId,
          autoAddNewMembers: enabled,
        })
        setViewingGroup((prev) => (prev ? { ...prev, autoAddNewMembers: enabled } : null))
      } catch (error) {
        logger.error('Failed to toggle auto-add', error)
      }
    },
    [viewingGroup, workspaceId, updatePermissionGroup]
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

  const isModelAllowed = useCallback(
    (model: string) => {
      if (!editingConfig) return true
      const normalized = model.toLowerCase()
      return !editingConfig.deniedModels.some((denied) => denied.toLowerCase() === normalized)
    },
    [editingConfig]
  )

  const toggleModel = useCallback(
    (model: string) => {
      if (!editingConfig) return
      const normalized = model.toLowerCase()
      const isDenied = editingConfig.deniedModels.some(
        (denied) => denied.toLowerCase() === normalized
      )
      const deniedModels = isDenied
        ? editingConfig.deniedModels.filter((denied) => denied.toLowerCase() !== normalized)
        : [...editingConfig.deniedModels, model]
      setEditingConfig({ ...editingConfig, deniedModels })
    },
    [editingConfig]
  )

  const setModelsDenied = useCallback(
    (models: string[], denied: boolean) => {
      if (!editingConfig) return
      if (denied) {
        const existing = new Set(editingConfig.deniedModels.map((m) => m.toLowerCase()))
        const additions = models.filter((m) => !existing.has(m.toLowerCase()))
        if (additions.length === 0) return
        setEditingConfig({
          ...editingConfig,
          deniedModels: [...editingConfig.deniedModels, ...additions],
        })
      } else {
        const toRemove = new Set(models.map((m) => m.toLowerCase()))
        setEditingConfig({
          ...editingConfig,
          deniedModels: editingConfig.deniedModels.filter((m) => !toRemove.has(m.toLowerCase())),
        })
      }
    },
    [editingConfig]
  )

  const deniedCountByProvider = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const model of editingConfig?.deniedModels ?? []) {
      try {
        const providerId = getProviderFromModel(model)
        counts[providerId] = (counts[providerId] ?? 0) + 1
      } catch {
        // Unknown/blacklisted provider — omit from counts.
      }
    }
    return counts
  }, [editingConfig?.deniedModels])

  const availableMembersToAdd = useMemo(() => {
    const existingMemberUserIds = new Set(members.map((m) => m.userId))
    return workspaceMembers.filter((m) => !existingMemberUserIds.has(m.userId))
  }, [workspaceMembers, members])

  if (isLoading) {
    return null
  }

  if (!canManage) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
        Only workspace admins on Enterprise plans can manage Access Control settings.
      </div>
    )
  }

  if (viewingGroup) {
    return (
      <>
        <div className='flex h-full flex-col bg-[var(--bg)]'>
          <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
            <Chip leftIcon={ArrowLeft} onClick={handleBackToList}>
              Access Control
            </Chip>
            <div className='flex items-center gap-2'>
              <Chip
                variant='destructive'
                onClick={() => handleDeleteClick(viewingGroup)}
                disabled={deletingGroupIds.has(viewingGroup.id)}
              >
                {deletingGroupIds.has(viewingGroup.id) ? 'Deleting...' : 'Delete'}
              </Chip>
              <Chip onClick={handleOpenConfigModal}>Configure</Chip>
            </div>
          </div>

          <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
            <div className='mx-auto flex max-w-[48rem] flex-col gap-4.5 pt-4 pb-6'>
              <div className='flex flex-col gap-1'>
                <h3 className='font-medium text-[14px] text-[var(--text-body)]'>
                  {viewingGroup.name}
                </h3>
                {viewingGroup.description && (
                  <p className='text-[var(--text-muted)] text-sm'>{viewingGroup.description}</p>
                )}
              </div>

              <div className='flex items-center justify-between'>
                <div className='flex flex-col gap-0.5'>
                  <span className='font-medium text-[var(--text-primary)] text-sm'>
                    Auto-add new members
                  </span>
                  <span className='text-[var(--text-muted)] text-small'>
                    Automatically add new workspace members to this group
                  </span>
                </div>
                <Switch
                  checked={viewingGroup.autoAddNewMembers}
                  onCheckedChange={(checked) => handleToggleAutoAdd(checked)}
                  disabled={updatePermissionGroup.isPending}
                />
              </div>

              <div className='flex flex-col gap-2'>
                <div className='flex items-center justify-between'>
                  <span className='font-medium text-[var(--text-secondary)] text-sm'>Members</span>
                  <Chip variant='primary' leftIcon={Plus} onClick={handleOpenAddMembersModal}>
                    Add
                  </Chip>
                </div>

                {membersLoading ? (
                  <div className='flex flex-col gap-4.5'>
                    {[1, 2].map((i) => (
                      <div key={i} className='flex items-center justify-between'>
                        <div className='flex items-center gap-3'>
                          <Skeleton className='size-8 rounded-full' />
                          <div className='flex flex-col gap-1'>
                            <Skeleton className='h-[14px] w-[100px]' />
                            <Skeleton className='h-[12px] w-[150px]' />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : members.length === 0 ? (
                  <p className='text-[var(--text-muted)] text-sm'>
                    No members yet. Click "Add" to get started.
                  </p>
                ) : (
                  <div className='flex flex-col gap-4.5'>
                    {members.map((member) => {
                      const name = member.userName || 'Unknown'
                      const avatarInitial = name.charAt(0).toUpperCase()

                      return (
                        <div key={member.id} className='flex items-center justify-between'>
                          <div className='flex flex-1 items-center gap-3'>
                            <Avatar size='md'>
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
                              <div className='flex items-center gap-2'>
                                <span className='truncate font-medium text-[14px] text-[var(--text-body)]'>
                                  {name}
                                </span>
                              </div>
                              <div className='truncate text-[var(--text-muted)] text-small'>
                                {member.userEmail}
                              </div>
                            </div>
                          </div>

                          <Chip
                            onClick={() => handleRemoveMember(member.id)}
                            disabled={removeMember.isPending}
                            className='flex-shrink-0'
                          >
                            Remove
                          </Chip>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <ChipModal
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
          srTitle='Configure Permissions'
          size='xl'
        >
          <ChipModalHeader
            onClose={() => {
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
            Configure Permissions
          </ChipModalHeader>
          <ChipModalBody>
            <ChipModalTabs
              tabs={[
                { value: 'providers', label: 'Model Providers' },
                { value: 'blocks', label: 'Blocks' },
                { value: 'platform', label: 'Platform' },
              ]}
              value={configTab}
              onChange={(value) => setConfigTab(value as 'providers' | 'blocks' | 'platform')}
            />
            {configTab === 'providers' && (
              <div>
                <div className='flex items-center gap-2 pb-3'>
                  <ChipInput
                    icon={Search}
                    placeholder='Search providers...'
                    value={providerSearchTerm}
                    onChange={(e) => setProviderSearchTerm(e.target.value)}
                    className='min-w-0 flex-1'
                  />
                  <Chip
                    onClick={() => {
                      const allAllowed =
                        editingConfig?.allowedModelProviders === null ||
                        allProviderIds.every((id) =>
                          editingConfig?.allowedModelProviders?.includes(id)
                        )
                      setEditingConfig((prev) =>
                        prev ? { ...prev, allowedModelProviders: allAllowed ? [] : null } : prev
                      )
                    }}
                  >
                    {editingConfig?.allowedModelProviders === null ||
                    allProviderIds.every((id) => editingConfig?.allowedModelProviders?.includes(id))
                      ? 'Deselect All'
                      : 'Select All'}
                  </Chip>
                </div>
                <div className='flex flex-col gap-0.5'>
                  {filteredProviders.map((providerId) => (
                    <ProviderRow
                      key={providerId}
                      providerId={providerId}
                      isProviderAllowed={isProviderAllowed(providerId)}
                      onToggleProvider={() => toggleProvider(providerId)}
                      deniedCount={deniedCountByProvider[providerId] ?? 0}
                      workspaceId={workspaceId}
                      isModelAllowed={isModelAllowed}
                      onToggleModel={toggleModel}
                      onSetModelsDenied={setModelsDenied}
                    />
                  ))}
                </div>
              </div>
            )}
            {configTab === 'blocks' && (
              <div>
                <div className='flex items-center gap-2 pb-3'>
                  <ChipInput
                    icon={Search}
                    placeholder='Search blocks...'
                    value={integrationSearchTerm}
                    onChange={(e) => setIntegrationSearchTerm(e.target.value)}
                    className='min-w-0 flex-1'
                  />
                  <Chip
                    onClick={() => {
                      const allAllowed =
                        editingConfig?.allowedIntegrations === null ||
                        allBlocks.every((b) => editingConfig?.allowedIntegrations?.includes(b.type))
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
                    allBlocks.every((b) => editingConfig?.allowedIntegrations?.includes(b.type))
                      ? 'Deselect All'
                      : 'Select All'}
                  </Chip>
                </div>
                <div className='flex flex-col gap-4'>
                  {filteredCoreBlocks.length > 0 && (
                    <div className='flex flex-col gap-1.5'>
                      <span className='font-medium text-[var(--text-tertiary)] text-xs uppercase tracking-wide'>
                        Core Blocks
                      </span>
                      <div className='grid grid-cols-3 gap-x-2 gap-y-0.5'>
                        {filteredCoreBlocks.map((block) => {
                          const BlockIcon = block.icon
                          const checkboxId = `block-${block.type}`
                          return (
                            <label
                              key={block.type}
                              htmlFor={checkboxId}
                              className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-[5px] transition-colors hover-hover:bg-[var(--surface-active)]'
                            >
                              <Checkbox
                                id={checkboxId}
                                checked={isIntegrationAllowed(block.type)}
                                onCheckedChange={() => toggleIntegration(block.type)}
                              />
                              <div
                                className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-sm'
                                style={{ background: block.bgColor }}
                              >
                                {BlockIcon && (
                                  <BlockIcon className='!h-[10px] !w-[10px] text-white' />
                                )}
                              </div>
                              <span className='truncate font-medium text-sm'>{block.name}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {filteredToolBlocks.length > 0 && (
                    <div className='flex flex-col gap-1.5 border-[var(--border)] border-t pt-4'>
                      <span className='font-medium text-[var(--text-tertiary)] text-xs uppercase tracking-wide'>
                        Tools
                      </span>
                      <div className='grid grid-cols-3 gap-x-2 gap-y-0.5'>
                        {filteredToolBlocks.map((block) => {
                          const BlockIcon = block.icon
                          const checkboxId = `block-${block.type}`
                          return (
                            <label
                              key={block.type}
                              htmlFor={checkboxId}
                              className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-[5px] transition-colors hover-hover:bg-[var(--surface-active)]'
                            >
                              <Checkbox
                                id={checkboxId}
                                checked={isIntegrationAllowed(block.type)}
                                onCheckedChange={() => toggleIntegration(block.type)}
                              />
                              <div
                                className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-sm'
                                style={{ background: block.bgColor }}
                              >
                                {BlockIcon && (
                                  <BlockIcon className='!h-[10px] !w-[10px] text-white' />
                                )}
                              </div>
                              <span className='truncate font-medium text-sm'>{block.name}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {configTab === 'platform' && (
              <div>
                <div className='flex items-center gap-2 pb-3'>
                  <ChipInput
                    icon={Search}
                    placeholder='Search features...'
                    value={platformSearchTerm}
                    onChange={(e) => setPlatformSearchTerm(e.target.value)}
                    className='min-w-0 flex-1'
                  />
                  <Chip
                    onClick={() => {
                      const allVisible = platformFeatures.every(
                        (f) => !editingConfig?.[f.configKey]
                      )
                      setEditingConfig((prev) =>
                        prev
                          ? {
                              ...prev,
                              ...Object.fromEntries(
                                platformFeatures.map((f) => [f.configKey, allVisible])
                              ),
                            }
                          : prev
                      )
                    }}
                  >
                    {platformFeatures.every((f) => !editingConfig?.[f.configKey])
                      ? 'Deselect All'
                      : 'Select All'}
                  </Chip>
                </div>
                <div className='grid grid-cols-3 gap-x-6'>
                  {platformCategoryColumns.map((column, columnIndex) => (
                    <div key={columnIndex} className='flex flex-col gap-8'>
                      {column.map(({ category, features }) => (
                        <div key={category} className='flex flex-col gap-1.5'>
                          <span className='font-medium text-[var(--text-tertiary)] text-xs uppercase tracking-wide'>
                            {category}
                          </span>
                          <div className='flex flex-col gap-0.5'>
                            {features.map((feature) => (
                              <label
                                key={feature.id}
                                htmlFor={feature.id}
                                className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-[5px] transition-colors hover-hover:bg-[var(--surface-active)]'
                              >
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
                                <span className='font-normal text-sm'>{feature.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ChipModalBody>
          <ChipModalFooter
            onCancel={handleCloseConfigModal}
            primaryAction={{
              label: updatePermissionGroup.isPending ? 'Saving...' : 'Save',
              onClick: handleSaveConfig,
              disabled: updatePermissionGroup.isPending || !hasConfigChanges,
            }}
          />
        </ChipModal>

        <ChipModal
          open={showUnsavedChanges}
          onOpenChange={setShowUnsavedChanges}
          size='sm'
          srTitle='Unsaved Changes'
        >
          <ChipModalHeader onClose={() => setShowUnsavedChanges(false)}>
            Unsaved Changes
          </ChipModalHeader>
          <ChipModalBody>
            <p className='px-2 text-[var(--text-secondary)] text-sm'>
              You have unsaved changes. Do you want to save them before closing?
            </p>
          </ChipModalBody>
          <ChipModalFooter
            onCancel={() => setShowUnsavedChanges(false)}
            secondaryAction={{
              label: 'Discard Changes',
              onClick: handleDiscardConfig,
              variant: 'destructive',
            }}
            primaryAction={{
              label: updatePermissionGroup.isPending ? 'Saving...' : 'Save Changes',
              onClick: handleSaveConfigFromUnsaved,
              disabled: updatePermissionGroup.isPending,
            }}
          />
        </ChipModal>

        <AddMembersModal
          open={showAddMembersModal}
          onOpenChange={(open) => {
            setShowAddMembersModal(open)
            if (!open) setAddMembersError(null)
          }}
          availableMembers={availableMembersToAdd}
          selectedMemberIds={selectedMemberIds}
          setSelectedMemberIds={setSelectedMemberIds}
          onAddMembers={handleAddSelectedMembers}
          isAdding={bulkAddMembers.isPending}
          errorMessage={addMembersError}
        />
      </>
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
          <div className='mx-auto flex max-w-[48rem] flex-col gap-4.5 pt-4 pb-6'>
            <ChipInput
              icon={Search}
              placeholder='Search permission groups...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />

            {filteredGroups.length === 0 && searchTerm.trim() ? (
              <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
                No results found matching "{searchTerm}"
              </div>
            ) : permissionGroups.length === 0 ? (
              <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
                Click "Create Group" above to get started
              </div>
            ) : (
              <div className='flex flex-col gap-1'>
                {filteredGroups.map((group) => (
                  <button
                    key={group.id}
                    type='button'
                    onClick={() => setViewingGroup(group)}
                    className='flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
                  >
                    <div className='flex min-w-0 flex-1 flex-col'>
                      <div className='flex items-center gap-2'>
                        <span className='truncate text-[14px] text-[var(--text-body)]'>
                          {group.name}
                        </span>
                        {group.autoAddNewMembers && (
                          <span className='flex-shrink-0 rounded-sm bg-[var(--surface-3)] px-1.5 py-0.5 text-[var(--text-muted)] text-micro'>
                            Auto-enrolls
                          </span>
                        )}
                      </div>
                      <span className='truncate text-[12px] text-[var(--text-muted)]'>
                        {group.memberCount} member{group.memberCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <ArrowRight className='size-4 flex-shrink-0 text-[var(--text-icon)]' />
                  </button>
                ))}
              </div>
            )}
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
                id='auto-add-members'
                checked={newGroupAutoAdd}
                onCheckedChange={(checked) => setNewGroupAutoAdd(checked === true)}
              />
              <Label htmlFor='auto-add-members' className='cursor-pointer font-normal'>
                Auto-add new workspace members
              </Label>
            </div>
          </ChipModalField>
          <ChipModalError>{createError}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={handleCloseCreateModal}
          primaryAction={{
            label: createPermissionGroup.isPending ? 'Creating...' : 'Create',
            onClick: handleCreatePermissionGroup,
            disabled: !newGroupName.trim() || createPermissionGroup.isPending,
          }}
        />
      </ChipModal>

      <ChipConfirmModal
        open={!!deletingGroup}
        onOpenChange={() => setDeletingGroup(null)}
        srTitle='Delete Permission Group'
        title='Delete Permission Group'
        description={
          <>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>{deletingGroup?.name}</span>?{' '}
            <span className='text-[var(--text-error)]'>
              All members will be removed from this group.
            </span>{' '}
            This action cannot be undone.
          </>
        }
        confirm={{
          label: 'Delete',
          onClick: confirmDelete,
          pending: deletePermissionGroup.isPending,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
}
