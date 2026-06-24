'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { ArrowRight, ChevronDown, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Checkbox,
  Chip,
  ChipConfirmModal,
  ChipDropdown,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipModalTabs,
  chipVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Label,
  MoreHorizontal,
  Search,
  Skeleton,
  Switch,
  toast,
} from '@/components/emcn'
import { ArrowLeft } from '@/components/emcn/icons'
import type { ShareAuthType } from '@/lib/api/contracts/public-shares'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { cn } from '@/lib/core/utils/cn'
import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
import type { PermissionGroupConfig } from '@/lib/permission-groups/types'
import { getUserColor } from '@/lib/workspaces/colors'
import { MemberRow } from '@/app/workspace/[workspaceId]/settings/components/member-list'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { getAllBlocks } from '@/blocks'
import {
  type PermissionGroup,
  useBulkAddPermissionGroupMembers,
  useCreatePermissionGroup,
  useDeletePermissionGroup,
  useOrganizationWorkspaces,
  usePermissionGroupMembers,
  usePermissionGroups,
  useRemovePermissionGroupMember,
  useUpdatePermissionGroup,
  useUserPermissionConfig,
} from '@/ee/access-control/hooks/permission-groups'
import { useBlacklistedProviders } from '@/hooks/queries/allowed-providers'
import { useOrganizationRoster } from '@/hooks/queries/organization'
import { useProviderModels } from '@/hooks/queries/providers'
import {
  DYNAMIC_MODEL_PROVIDERS,
  getProviderModels,
  PROVIDER_DEFINITIONS,
} from '@/providers/models'
import type { ProviderId } from '@/providers/types'
import { getAllProviderIds, getProviderFromModel } from '@/providers/utils'
import type { ProviderName } from '@/stores/providers'

const logger = createLogger('AccessControl')

/** Public-file-share auth modes an admin can allow/disallow. `null` config = all allowed. */
const FILE_SHARE_AUTH_TYPE_OPTIONS: { value: ShareAuthType; label: string }[] = [
  { value: 'public', label: 'Anyone with link' },
  { value: 'password', label: 'Password' },
  { value: 'email', label: 'Email' },
  { value: 'sso', label: 'SSO' },
]
const ALL_FILE_SHARE_AUTH_TYPES: ShareAuthType[] = FILE_SHARE_AUTH_TYPE_OPTIONS.map((o) => o.value)

interface OrganizationMemberOption {
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
  availableMembers: OrganizationMemberOption[]
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
            All organization members are already in this group.
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

interface WorkspaceSelectProps {
  workspaceIds: string[]
  onChange: (ids: string[]) => void
  options: { value: string; label: string }[]
  disabled?: boolean
  isLoading?: boolean
  fullWidth?: boolean
  className?: string
  /**
   * When false, the "All workspaces" reset option is hidden and an empty
   * selection reads as a prompt. Non-default groups must target ≥1 workspace.
   */
  allowAllWorkspaces?: boolean
}

/**
 * Workspace scope multi-select. With `allowAllWorkspaces` an empty selection
 * reads as "All workspaces" (the default group); otherwise it prompts for a
 * selection, since non-default groups must target specific workspaces.
 */
function WorkspaceSelect({
  workspaceIds,
  onChange,
  options,
  disabled = false,
  isLoading = false,
  fullWidth = false,
  className,
  allowAllWorkspaces = true,
}: WorkspaceSelectProps) {
  return (
    <ChipDropdown
      multiple
      searchable
      align={fullWidth ? 'start' : 'end'}
      matchTriggerWidth={fullWidth}
      options={options}
      value={workspaceIds}
      onChange={onChange}
      disabled={disabled || isLoading}
      showAllOption={allowAllWorkspaces}
      allLabel={
        isLoading
          ? 'Loading workspaces…'
          : allowAllWorkspaces
            ? 'All workspaces'
            : 'Select workspaces…'
      }
      searchPlaceholder='Search workspaces…'
      fullWidth={fullWidth}
      className={className}
    />
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

  // Access control is governed by the workspace's OWNING organization, which may
  // differ from the caller's active org (e.g. external members). Resolve the org
  // id and the caller's admin status server-side from the workspace so gating is
  // never keyed off the session's active org.
  const { data: userPermissionConfig, isPending: entitlementLoading } =
    useUserPermissionConfig(workspaceId)
  const organizationId = userPermissionConfig?.organizationId ?? undefined
  const currentUserIsOrgAdmin = userPermissionConfig?.isOrgAdmin ?? false

  // Group + roster reads require org admin/owner on the host org; only fetch them
  // for admins to avoid surfacing expected 403s for non-admins/external members.
  const { data: permissionGroups = [], isPending: groupsLoading } = usePermissionGroups(
    organizationId,
    !!organizationId && currentUserIsOrgAdmin
  )
  const { data: roster } = useOrganizationRoster(currentUserIsOrgAdmin ? organizationId : undefined)
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
  const updatePermissionGroup = useUpdatePermissionGroup()
  const deletePermissionGroup = useDeletePermissionGroup()
  const bulkAddMembers = useBulkAddPermissionGroupMembers()

  const [searchTerm, setSearchTerm] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [viewingGroup, setViewingGroup] = useState<PermissionGroup | null>(null)
  // Monotonic token for scope-affecting writes (workspace select + default
  // toggle, which both change the group's workspace scope). Only the most
  // recent write may reconcile or revert the local viewingGroup, so rapid
  // multi-select toggles can't settle on a stale, out-of-order response.
  const scopeWriteSeqRef = useRef(0)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDescription, setNewGroupDescription] = useState('')
  const [newGroupIsDefault, setNewGroupIsDefault] = useState(false)
  const [newGroupWorkspaceIds, setNewGroupWorkspaceIds] = useState<string[]>([])
  const [createError, setCreateError] = useState<string | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<{ id: string; name: string } | null>(null)
  const [deletingGroupIds, setDeletingGroupIds] = useState<Set<string>>(() => new Set())

  const { data: members = [], isPending: membersLoading } = usePermissionGroupMembers(
    organizationId,
    viewingGroup?.id
  )
  const removeMember = useRemovePermissionGroupMember()

  const [showConfigModal, setShowConfigModal] = useState(false)
  const [configTab, setConfigTab] = useState<'members' | 'providers' | 'blocks' | 'platform'>(
    'providers'
  )
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
        label: 'Chat',
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
      {
        id: 'disable-public-file-sharing',
        label: 'Public Sharing',
        category: 'Files',
        configKey: 'disablePublicFileSharing' as const,
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
    // Files has its own section below (with the file-sharing auth modes), so it
    // stays out of the feature-toggle grid.
    const unassigned = Object.keys(platformCategories).filter(
      (c) => c !== 'Files' && !assignedCategories.has(c)
    )
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
    const blocks = getAllBlocks().filter((b) => !isBlockTypeAccessControlExempt(b.type))
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

  const organizationMembers = useMemo<OrganizationMemberOption[]>(() => {
    if (!roster?.members) return []
    return roster.members
      .filter((m) => m.role !== 'external')
      .map((m) => ({
        userId: m.userId,
        user: {
          name: m.name,
          email: m.email,
          image: m.image,
        },
      }))
  }, [roster])

  const workspaceOptions = useMemo(
    () => organizationWorkspaces.map((ws) => ({ value: ws.id, label: ws.name })),
    [organizationWorkspaces]
  )

  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return permissionGroups
    const searchLower = searchTerm.toLowerCase()
    return permissionGroups.filter((g) => g.name.toLowerCase().includes(searchLower))
  }, [permissionGroups, searchTerm])

  const handleCreatePermissionGroup = useCallback(async () => {
    if (!newGroupName.trim() || !organizationId) return
    setCreateError(null)
    try {
      await createPermissionGroup.mutateAsync({
        organizationId,
        name: newGroupName.trim(),
        description: newGroupDescription.trim() || undefined,
        isDefault: newGroupIsDefault,
        // Only the default group is organization-wide; every other group targets
        // specific workspaces (omitted for the default group).
        workspaceIds: newGroupIsDefault ? undefined : newGroupWorkspaceIds,
      })
      setShowCreateModal(false)
      setNewGroupName('')
      setNewGroupDescription('')
      setNewGroupIsDefault(false)
      setNewGroupWorkspaceIds([])
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

  const handleBackToList = useCallback(() => {
    setViewingGroup(null)
  }, [])

  const handleDeleteClick = useCallback((group: PermissionGroup) => {
    setDeletingGroup({ id: group.id, name: group.name })
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!deletingGroup || !organizationId) return
    setDeletingGroupIds((prev) => new Set(prev).add(deletingGroup.id))
    try {
      await deletePermissionGroup.mutateAsync({
        permissionGroupId: deletingGroup.id,
        organizationId,
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
  }, [deletingGroup, organizationId, deletePermissionGroup, viewingGroup?.id])

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
      if (!viewingGroup || !organizationId) return
      try {
        await removeMember.mutateAsync({
          organizationId,
          permissionGroupId: viewingGroup.id,
          memberId,
        })
      } catch (error) {
        logger.error('Failed to remove member', error)
        toast.error("Couldn't remove member", {
          description: getErrorMessage(error, 'Please try again in a moment.'),
        })
      }
    },
    [viewingGroup, organizationId, removeMember]
  )

  const handleOpenConfigModal = useCallback(() => {
    if (!viewingGroup) return
    setEditingConfig({ ...viewingGroup.config })
    setConfigTab('providers')
    setShowConfigModal(true)
  }, [viewingGroup])

  const handleSaveConfig = useCallback(async () => {
    if (!viewingGroup || !editingConfig || !organizationId) return
    try {
      await updatePermissionGroup.mutateAsync({
        id: viewingGroup.id,
        organizationId,
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
  }, [viewingGroup, editingConfig, organizationId, updatePermissionGroup])

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
    if (!viewingGroup || !organizationId || selectedMemberIds.size === 0) return
    setAddMembersError(null)
    try {
      // Bulk add is all-or-nothing for conflicts: a conflicting selection
      // returns a 409 (no one is added) and the named error is shown inline so
      // the admin can adjust the selection.
      await bulkAddMembers.mutateAsync({
        organizationId,
        permissionGroupId: viewingGroup.id,
        userIds: Array.from(selectedMemberIds),
      })
      setShowAddMembersModal(false)
      setSelectedMemberIds(new Set())
    } catch (error) {
      logger.error('Failed to add members', error)
      setAddMembersError(getErrorMessage(error, 'Failed to add members'))
    }
  }, [viewingGroup, organizationId, selectedMemberIds, bulkAddMembers])

  const handleScopeChange = useCallback(
    async (workspaceIds: string[]) => {
      if (!viewingGroup || !organizationId) return
      // Zero workspaces is allowed: the group then governs nothing (the resolver
      // inner-joins on the workspace link table, so an empty group never matches
      // any workspace). Re-add a workspace to make it active again.
      const previous = viewingGroup
      const seq = ++scopeWriteSeqRef.current

      setViewingGroup((prev) =>
        prev
          ? {
              ...prev,
              workspaces: organizationWorkspaces.filter((ws) => workspaceIds.includes(ws.id)),
            }
          : null
      )
      try {
        const result = await updatePermissionGroup.mutateAsync({
          id: viewingGroup.id,
          organizationId,
          workspaceIds,
        })

        if (seq !== scopeWriteSeqRef.current) return
        setViewingGroup((prev) =>
          prev
            ? {
                ...prev,
                workspaces: organizationWorkspaces.filter((ws) =>
                  result.permissionGroup.workspaceIds.includes(ws.id)
                ),
              }
            : null
        )
      } catch (error) {
        logger.error('Failed to update workspace scope', error)
        // Only the latest write may revert, so a failed earlier request can't
        // clobber a newer (successful) selection.
        if (seq !== scopeWriteSeqRef.current) return
        setViewingGroup(previous)
        toast.error("Couldn't update workspaces", {
          description: getErrorMessage(error, 'Please try again in a moment.'),
        })
      }
    },
    [viewingGroup, organizationId, organizationWorkspaces, updatePermissionGroup]
  )

  const handleToggleDefault = useCallback(
    async (enabled: boolean) => {
      if (!viewingGroup || !organizationId) return
      const seq = ++scopeWriteSeqRef.current
      try {
        // Promoting forces all-workspaces; demoting leaves the group non-default
        // with no workspaces (inert) until it is re-scoped from the selector — the
        // route handles this from `isDefault: false` alone, so no workspace list
        // (bounded by the per-group cap) is sent.
        const result = await updatePermissionGroup.mutateAsync({
          id: viewingGroup.id,
          organizationId,
          isDefault: enabled,
        })

        if (seq !== scopeWriteSeqRef.current) return
        setViewingGroup((prev) =>
          prev
            ? {
                ...prev,
                isDefault: result.permissionGroup.isDefault,
                workspaces: result.permissionGroup.isDefault
                  ? []
                  : organizationWorkspaces.filter((ws) =>
                      result.permissionGroup.workspaceIds.includes(ws.id)
                    ),
              }
            : null
        )
      } catch (error) {
        logger.error('Failed to toggle default group', error)
        toast.error("Couldn't update the default group", {
          description: getErrorMessage(error, 'Please try again in a moment.'),
        })
      }
    },
    [viewingGroup, organizationId, organizationWorkspaces, updatePermissionGroup]
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

  const isFileShareAuthAllowed = useCallback(
    (authType: ShareAuthType) => {
      if (!editingConfig) return true
      return (
        editingConfig.allowedFileShareAuthTypes === null ||
        editingConfig.allowedFileShareAuthTypes.includes(authType)
      )
    },
    [editingConfig]
  )

  const toggleFileShareAuthType = useCallback(
    (authType: ShareAuthType) => {
      if (!editingConfig) return
      const current = editingConfig.allowedFileShareAuthTypes
      const next =
        current === null
          ? ALL_FILE_SHARE_AUTH_TYPES.filter((t) => t !== authType)
          : current.includes(authType)
            ? current.filter((t) => t !== authType)
            : [...current, authType]
      // A full list collapses back to `null` ("all allowed").
      setEditingConfig({
        ...editingConfig,
        allowedFileShareAuthTypes: next.length === ALL_FILE_SHARE_AUTH_TYPES.length ? null : next,
      })
    },
    [editingConfig]
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
    return organizationMembers.filter((m) => !existingMemberUserIds.has(m.userId))
  }, [organizationMembers, members])

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

  const deleteConfirmModal = (
    <ChipConfirmModal
      open={!!deletingGroup}
      onOpenChange={() => setDeletingGroup(null)}
      srTitle='Delete Permission Group'
      title='Delete Permission Group'
      text={[
        'Are you sure you want to delete ',
        { text: deletingGroup?.name ?? 'this group', bold: true },
        '? ',
        { text: 'All members will be removed from this group.', error: true },
        ' This action cannot be undone.',
      ]}
      confirm={{
        label: 'Delete',
        onClick: confirmDelete,
        pending: deletePermissionGroup.isPending,
        pendingLabel: 'Deleting...',
      }}
    />
  )

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
            <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>
              <div className='flex flex-col gap-1'>
                <h1 className='font-medium text-[var(--text-body)] text-lg'>{viewingGroup.name}</h1>
                {viewingGroup.description && (
                  <p className='text-[var(--text-muted)] text-md'>{viewingGroup.description}</p>
                )}
                {!viewingGroup.isDefault && !membersLoading && (
                  <p className='text-[var(--text-muted)] text-md'>
                    {viewingGroup.workspaces.length === 0
                      ? 'Applies to no one yet — add workspaces below to choose who this group governs.'
                      : members.length === 0
                        ? 'Applies to all members of its workspaces.'
                        : `Restricted to ${members.length} member${members.length === 1 ? '' : 's'}.`}
                  </p>
                )}
              </div>

              <SettingsSection label='Default group'>
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-[var(--text-muted)] text-small'>
                    Applies to everyone in the organization not assigned to another group, including
                    external workspace members
                  </span>
                  <Switch
                    checked={viewingGroup.isDefault}
                    onCheckedChange={(checked) => handleToggleDefault(checked)}
                    disabled={updatePermissionGroup.isPending}
                  />
                </div>
              </SettingsSection>

              <SettingsSection label='Workspaces'>
                {viewingGroup.isDefault ? (
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-[var(--text-muted)] text-small'>
                      Governs every workspace in the organization
                    </span>
                  </div>
                ) : (
                  <div className='flex flex-col gap-3'>
                    <div className='flex items-center justify-between gap-3'>
                      <span className='min-w-0 text-[var(--text-muted)] text-small'>
                        {viewingGroup.workspaces.length > 0
                          ? `Governs ${viewingGroup.workspaces.length} workspace${
                              viewingGroup.workspaces.length === 1 ? '' : 's'
                            }`
                          : 'Select the workspaces this group governs'}
                      </span>
                      <WorkspaceSelect
                        workspaceIds={viewingGroup.workspaces.map((ws) => ws.id)}
                        onChange={handleScopeChange}
                        options={workspaceOptions}
                        isLoading={workspacesLoading}
                        allowAllWorkspaces={false}
                        className='flex-shrink-0'
                      />
                    </div>
                    {viewingGroup.workspaces.length > 0 && (
                      <div className='-mx-2 flex flex-col gap-y-0.5'>
                        {viewingGroup.workspaces.map((ws) => (
                          <MemberRow
                            key={ws.id}
                            name={ws.name}
                            email={ws.name}
                            image={null}
                            status=''
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </SettingsSection>
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
          className='h-[84vh]'
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
                ...(viewingGroup.isDefault ? [] : [{ value: 'members', label: 'Members' }]),
              ]}
              value={configTab}
              onChange={(value) =>
                setConfigTab(value as 'members' | 'providers' | 'blocks' | 'platform')
              }
            />
            {configTab === 'members' && !viewingGroup.isDefault && (
              <div className='flex min-h-0 flex-1 flex-col gap-3'>
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-[var(--text-body)] text-sm'>
                    {members.length === 0
                      ? 'Applies to all members'
                      : `Restricted to ${members.length} member${members.length === 1 ? '' : 's'}`}
                  </span>
                  <Chip
                    variant='primary'
                    leftIcon={Plus}
                    onClick={handleOpenAddMembersModal}
                    className='flex-shrink-0'
                  >
                    Add
                  </Chip>
                </div>
                {membersLoading ? (
                  <div className='-mx-2 flex flex-col gap-y-0.5'>
                    {[1, 2].map((i) => (
                      <div key={i} className='flex items-center gap-2.5 p-2'>
                        <Skeleton className='size-[14px] flex-shrink-0 rounded-full' />
                        <Skeleton className='h-[14px] w-[180px]' />
                      </div>
                    ))}
                  </div>
                ) : members.length === 0 ? (
                  <div className='flex flex-1 items-center justify-center px-6 text-center'>
                    <span className='max-w-md text-[var(--text-muted)] text-sm'>
                      This group applies to everyone in its workspaces, including external members.
                      Add members to restrict it to specific people.
                    </span>
                  </div>
                ) : (
                  <div className='-mx-2 flex flex-col gap-y-0.5'>
                    {members.map((member) => (
                      <MemberRow
                        key={member.id}
                        name={member.userName || member.userEmail || 'Unknown'}
                        email={member.userEmail || member.userName || 'Unknown'}
                        image={member.userImage}
                        status={`Added ${new Date(member.assignedAt).toLocaleDateString()}`}
                        menu={
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type='button'
                                aria-label='Member actions'
                                className={chipVariants({ flush: true })}
                              >
                                <MoreHorizontal className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align='end'>
                              <DropdownMenuItem
                                className='text-[var(--text-error)]'
                                onSelect={() => handleRemoveMember(member.id)}
                              >
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
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
                        Integrations and Triggers
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
                <div className='mt-8 flex flex-col gap-1.5'>
                  <span className='font-medium text-[var(--text-tertiary)] text-xs uppercase tracking-wide'>
                    Files
                  </span>
                  <label
                    htmlFor='disable-public-file-sharing'
                    className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-[5px] transition-colors hover-hover:bg-[var(--surface-active)]'
                  >
                    <Checkbox
                      id='disable-public-file-sharing'
                      checked={!editingConfig?.disablePublicFileSharing}
                      onCheckedChange={(checked) =>
                        setEditingConfig((prev) =>
                          prev ? { ...prev, disablePublicFileSharing: checked !== true } : prev
                        )
                      }
                    />
                    <span className='font-normal text-sm'>Public Sharing</span>
                  </label>
                  <div
                    className={cn(
                      'flex flex-col gap-1 pt-1',
                      editingConfig?.disablePublicFileSharing && 'opacity-50'
                    )}
                  >
                    <span className='px-2 text-[var(--text-secondary)] text-xs'>
                      Auth modes public file-share links may use
                    </span>
                    <div className='flex flex-wrap gap-x-4'>
                      {FILE_SHARE_AUTH_TYPE_OPTIONS.map(({ value, label }) => (
                        <label
                          key={value}
                          htmlFor={`fsauth-${value}`}
                          className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-[5px] transition-colors hover-hover:bg-[var(--surface-active)]'
                        >
                          <Checkbox
                            id={`fsauth-${value}`}
                            checked={isFileShareAuthAllowed(value)}
                            onCheckedChange={() => toggleFileShareAuthType(value)}
                            disabled={editingConfig?.disablePublicFileSharing}
                          />
                          <span className='font-normal text-sm'>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </ChipModalBody>
          {configTab !== 'members' && (
            <ChipModalFooter
              onCancel={handleCloseConfigModal}
              primaryAction={{
                label: updatePermissionGroup.isPending ? 'Saving...' : 'Save',
                onClick: handleSaveConfig,
                disabled: updatePermissionGroup.isPending || !hasConfigChanges,
              }}
            />
          )}
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
            secondaryActions={[
              {
                label: 'Discard Changes',
                onClick: handleDiscardConfig,
                variant: 'destructive',
              },
            ]}
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

        {deleteConfirmModal}
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
                      onClick={() => setViewingGroup(group)}
                      className='flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
                    >
                      <div className='flex min-w-0 flex-1 flex-col'>
                        <div className='flex items-center gap-2'>
                          <span className='truncate text-[14px] text-[var(--text-body)]'>
                            {group.name}
                          </span>
                          {group.isDefault && (
                            <span className='flex-shrink-0 rounded-sm bg-[var(--surface-3)] px-1.5 py-0.5 text-[var(--text-muted)] text-micro'>
                              Default
                            </span>
                          )}
                        </div>
                        <span className='truncate text-[12px] text-[var(--text-muted)]'>
                          {group.isDefault
                            ? 'Everyone in the organization'
                            : `${
                                group.memberCount === 0
                                  ? 'All members'
                                  : `${group.memberCount} member${
                                      group.memberCount === 1 ? '' : 's'
                                    }`
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
                  later from Configure → Members.
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

      {deleteConfirmModal}
    </>
  )
}
