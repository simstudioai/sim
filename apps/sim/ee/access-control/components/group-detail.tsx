'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { ChevronDown, Plus } from 'lucide-react'
import {
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
  ChipTag,
  chipVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Info,
  MoreHorizontal,
  Search,
  Skeleton,
  Switch,
  toast,
} from '@/components/emcn'
import { ArrowLeft } from '@/components/emcn/icons'
import type { ShareAuthType } from '@/lib/api/contracts/public-shares'
import { cn } from '@/lib/core/utils/cn'
import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
import type { PermissionGroupConfig } from '@/lib/permission-groups/types'
import {
  MemberAvatar,
  MemberRow,
} from '@/app/workspace/[workspaceId]/settings/components/member-list'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { getAllBlocks } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'
import { WorkspaceSelect } from '@/ee/access-control/components/workspace-select'
import {
  type PermissionGroup,
  type PermissionGroupWorkspaceRef,
  useBulkAddPermissionGroupMembers,
  useDeletePermissionGroup,
  usePermissionGroupMembers,
  useRemovePermissionGroupMember,
  useUpdatePermissionGroup,
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
import { getTool } from '@/tools/utils'

const logger = createLogger('AccessControlGroupDetail')

type ConfigTab = 'general' | 'providers' | 'blocks' | 'platform'

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
                      const isSelected = selectedMemberIds.has(member.userId)

                      return (
                        <button
                          key={member.userId}
                          type='button'
                          onClick={() => handleToggleMember(member.userId)}
                          className='flex items-center gap-2.5 rounded-sm p-2 text-left hover-hover:bg-[var(--surface-active)]'
                        >
                          <Checkbox checked={isSelected} />
                          <MemberAvatar name={name} image={member.user?.image ?? null} />
                          <div className='min-w-0 flex-1'>
                            <div className='truncate text-[14px] text-[var(--text-body)]'>
                              {name}
                            </div>
                            <div className='truncate text-[12px] text-[var(--text-muted)]'>
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

interface DenylistGridItem {
  id: string
  label: string
}

interface DenylistControls {
  isAllowed: (id: string) => boolean
  onToggle: (id: string) => void
  onSetDenied: (ids: string[], denied: boolean) => void
}

interface CheckboxGridProps extends DenylistControls {
  items: DenylistGridItem[]
  isLoading: boolean
  searchPlaceholder: string
  emptyLabel: string
}

/**
 * Searchable two-column checkbox grid over a denylist. A checked item is
 * allowed; unchecking adds it to the denylist. Shared by the model deny-list
 * (per provider) and the tool deny-list (per integration block).
 */
function CheckboxGrid({
  items,
  isLoading,
  searchPlaceholder,
  emptyLabel,
  isAllowed,
  onToggle,
  onSetDenied,
}: CheckboxGridProps) {
  const [search, setSearch] = useState('')

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.label.localeCompare(b.label)),
    [items]
  )

  const filteredItems = useMemo(() => {
    if (!search.trim()) return sortedItems
    const query = search.toLowerCase()
    return sortedItems.filter(
      (item) => item.label.toLowerCase().includes(query) || item.id.toLowerCase().includes(query)
    )
  }, [sortedItems, search])

  if (isLoading) {
    return <div className='px-2 py-3 text-[var(--text-muted)] text-xs'>Loading…</div>
  }

  if (items.length === 0) {
    return <div className='px-2 py-3 text-[var(--text-muted)] text-xs'>{emptyLabel}</div>
  }

  const allFilteredAllowed = filteredItems.every((item) => isAllowed(item.id))

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center gap-2'>
        <ChipInput
          icon={Search}
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='min-w-0 flex-1'
        />
        <Chip
          onClick={() =>
            onSetDenied(
              filteredItems.map((item) => item.id),
              allFilteredAllowed
            )
          }
        >
          {allFilteredAllowed ? 'Block All' : 'Allow All'}
        </Chip>
      </div>
      <div className='grid grid-cols-2 gap-x-2 gap-y-0.5'>
        {filteredItems.map((item) => {
          const checkboxId = `denylist-${item.id}`
          return (
            <label
              key={item.id}
              htmlFor={checkboxId}
              className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-[5px] transition-colors hover-hover:bg-[var(--surface-active)]'
            >
              <Checkbox
                id={checkboxId}
                checked={isAllowed(item.id)}
                onCheckedChange={() => onToggle(item.id)}
              />
              <span className='truncate text-sm'>{item.label}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

interface DynamicProviderModelsProps extends DenylistControls {
  provider: ProviderName
  workspaceId?: string
}

function DynamicProviderModels({ provider, workspaceId, ...controls }: DynamicProviderModelsProps) {
  const { data, isPending } = useProviderModels(provider, workspaceId)
  const items = useMemo(
    () => (data?.models ?? []).map((model) => ({ id: model, label: model })),
    [data?.models]
  )
  return (
    <CheckboxGrid
      items={items}
      isLoading={isPending}
      searchPlaceholder='Search models...'
      emptyLabel='No models available for this provider.'
      {...controls}
    />
  )
}

interface StaticProviderModelsProps extends DenylistControls {
  providerId: ProviderId
}

function StaticProviderModels({ providerId, ...controls }: StaticProviderModelsProps) {
  const items = useMemo(
    () => getProviderModels(providerId).map((model) => ({ id: model, label: model })),
    [providerId]
  )
  return (
    <CheckboxGrid
      items={items}
      isLoading={false}
      searchPlaceholder='Search models...'
      emptyLabel='No models available for this provider.'
      {...controls}
    />
  )
}

interface ProviderRowProps extends DenylistControls {
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
            <ChipTag variant='gray' className='flex-shrink-0'>
              {deniedCount} blocked
            </ChipTag>
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

interface BlockToolRowProps extends DenylistControls {
  block: BlockConfig
  isBlockAllowed: boolean
  onToggleBlock: () => void
  deniedCount: number
}

/**
 * Integration/trigger block row. The checkbox drives whole-block access
 * (`allowedIntegrations`); when allowed and the block exposes more than one
 * tool, the row expands to a per-tool deny-list grid (`deniedTools`), mirroring
 * the provider → models pattern.
 */
function BlockToolRow({
  block,
  isBlockAllowed,
  onToggleBlock,
  deniedCount,
  ...controls
}: BlockToolRowProps) {
  const [expanded, setExpanded] = useState(false)
  const BlockIcon = block.icon
  const checkboxId = `block-${block.type}`

  const toolItems = useMemo<DenylistGridItem[]>(
    () => (block.tools?.access ?? []).map((id) => ({ id, label: getTool(id)?.name ?? id })),
    [block.tools?.access]
  )
  const isExpandable = toolItems.length > 1

  return (
    <div>
      <div className='flex items-center gap-2 rounded-md px-2 py-[5px] transition-colors hover-hover:bg-[var(--surface-active)]'>
        <Checkbox
          id={checkboxId}
          checked={isBlockAllowed}
          onCheckedChange={() => onToggleBlock()}
        />
        <div
          className='relative flex size-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-sm'
          style={{ background: block.bgColor }}
        >
          {BlockIcon && <BlockIcon className='!h-[10px] !w-[10px] text-white' />}
        </div>
        <button
          type='button'
          onClick={() => isBlockAllowed && isExpandable && setExpanded((prev) => !prev)}
          disabled={!isBlockAllowed || !isExpandable}
          className={cn(
            'flex flex-1 items-center gap-2 text-left',
            isBlockAllowed && isExpandable ? 'cursor-pointer' : 'cursor-default',
            !isBlockAllowed && 'opacity-60'
          )}
        >
          <span className='truncate font-medium text-sm'>{block.name}</span>
          {isBlockAllowed && deniedCount > 0 && (
            <ChipTag variant='gray' className='flex-shrink-0'>
              {deniedCount} blocked
            </ChipTag>
          )}
          {isBlockAllowed && isExpandable && (
            <ChevronDown
              className={cn(
                'ml-auto size-[14px] flex-shrink-0 text-[var(--text-tertiary)] transition-transform',
                expanded && 'rotate-180'
              )}
            />
          )}
        </button>
      </div>
      {expanded && isBlockAllowed && isExpandable && (
        <div className='border-[var(--border)] border-t px-2 pt-2 pb-3'>
          <CheckboxGrid
            items={toolItems}
            isLoading={false}
            searchPlaceholder='Search tools...'
            emptyLabel='This integration exposes no configurable tools.'
            {...controls}
          />
        </div>
      )}
    </div>
  )
}

interface GroupDetailProps {
  group: PermissionGroup
  organizationId: string
  workspaceId?: string
  workspaceOptions: { value: string; label: string }[]
  organizationWorkspaces: PermissionGroupWorkspaceRef[]
  workspacesLoading: boolean
  onBack: () => void
  onDeleted: () => void
}

/**
 * Full-surface, tabbed configuration view for a single permission group. Owns
 * its own editing buffer (`editingConfig`), scope/default writes, and member
 * management — replacing the former cramped configure modal.
 */
export function GroupDetail({
  group,
  organizationId,
  workspaceId,
  workspaceOptions,
  organizationWorkspaces,
  workspacesLoading,
  onBack,
  onDeleted,
}: GroupDetailProps) {
  const updatePermissionGroup = useUpdatePermissionGroup()
  const deletePermissionGroup = useDeletePermissionGroup()
  const removeMember = useRemovePermissionGroupMember()
  const bulkAddMembers = useBulkAddPermissionGroupMembers()

  /**
   * Local, authoritative copy of the group while the detail view is open. Seeded
   * from the prop and re-seeded only when the selected group id changes, so
   * optimistic scope/default/config writes are not clobbered by list refetches.
   */
  const [viewingGroup, setViewingGroup] = useState<PermissionGroup>(group)
  const [editingConfig, setEditingConfig] = useState<PermissionGroupConfig>({ ...group.config })
  const prevGroupIdRef = useRef(group.id)
  if (prevGroupIdRef.current !== group.id) {
    prevGroupIdRef.current = group.id
    setViewingGroup(group)
    setEditingConfig({ ...group.config })
  }

  /**
   * Monotonic token for scope-affecting writes (workspace select + default
   * toggle). Only the most recent write may reconcile or revert the local
   * group, so rapid multi-select toggles can't settle on a stale response.
   */
  const scopeWriteSeqRef = useRef(0)

  const [configTab, setConfigTab] = useState<ConfigTab>('general')
  const [providerSearchTerm, setProviderSearchTerm] = useState('')
  const [integrationSearchTerm, setIntegrationSearchTerm] = useState('')
  const [platformSearchTerm, setPlatformSearchTerm] = useState('')

  const [showAddMembersModal, setShowAddMembersModal] = useState(false)
  const [addMembersError, setAddMembersError] = useState<string | null>(null)
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(() => new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showUnsavedChanges, setShowUnsavedChanges] = useState(false)

  const { data: members = [], isPending: membersLoading } = usePermissionGroupMembers(
    organizationId,
    viewingGroup.id
  )
  const { data: roster } = useOrganizationRoster(organizationId)
  const { data: blacklistedProvidersData } = useBlacklistedProviders({ enabled: true })

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

  const allProviderIds = useMemo(() => {
    const allIds = getAllProviderIds()
    const blacklist = blacklistedProvidersData?.blacklistedProviders ?? []
    if (blacklist.length === 0) return allIds
    return allIds.filter((id) => !blacklist.includes(id.toLowerCase()))
  }, [blacklistedProvidersData])

  /** Maps every tool id to ALL block types that expose it (some tools are shared across blocks). */
  const toolBlockTypes = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const block of allBlocks) {
      for (const toolId of block.tools?.access ?? []) {
        ;(map[toolId] ??= []).push(block.type)
      }
    }
    return map
  }, [allBlocks])

  const platformFeatures = useMemo(
    () => [
      {
        id: 'hide-knowledge-base',
        label: 'Knowledge Base',
        category: 'Sidebar',
        configKey: 'hideKnowledgeBaseTab' as const,
        hint: 'Hide the Knowledge Base module from the sidebar.',
      },
      {
        id: 'hide-tables',
        label: 'Tables',
        category: 'Sidebar',
        configKey: 'hideTablesTab' as const,
        hint: 'Hide the Tables module from the sidebar.',
      },
      {
        id: 'hide-copilot',
        label: 'Chat',
        category: 'Workflow Panel',
        configKey: 'hideCopilot' as const,
        hint: 'Hide the Chat panel so users cannot build or edit with natural language.',
      },
      {
        id: 'hide-integrations',
        label: 'Integrations',
        category: 'Settings Tabs',
        configKey: 'hideIntegrationsTab' as const,
        hint: 'Hide the Integrations settings tab (OAuth connections).',
      },
      {
        id: 'hide-secrets',
        label: 'Secrets',
        category: 'Settings Tabs',
        configKey: 'hideSecretsTab' as const,
        hint: 'Hide the Secrets (environment variables) settings tab.',
      },
      {
        id: 'hide-api-keys',
        label: 'API Keys',
        category: 'Settings Tabs',
        configKey: 'hideApiKeysTab' as const,
        hint: 'Hide the API Keys settings tab.',
      },
      {
        id: 'hide-files',
        label: 'Files',
        category: 'Settings Tabs',
        configKey: 'hideFilesTab' as const,
        hint: 'Hide the Files settings tab.',
      },
      {
        id: 'hide-deploy-api',
        label: 'API',
        category: 'Deploy Tabs',
        configKey: 'hideDeployApi' as const,
        hint: 'Hide the API deployment option.',
      },
      {
        id: 'hide-deploy-mcp',
        label: 'MCP',
        category: 'Deploy Tabs',
        configKey: 'hideDeployMcp' as const,
        hint: 'Hide the MCP server deployment option.',
      },
      {
        id: 'hide-deploy-a2a',
        label: 'A2A',
        category: 'Deploy Tabs',
        configKey: 'hideDeployA2a' as const,
        hint: 'Hide the agent-to-agent deployment option.',
      },
      {
        id: 'hide-deploy-chatbot',
        label: 'Chat',
        category: 'Deploy Tabs',
        configKey: 'hideDeployChatbot' as const,
        hint: 'Hide the chatbot deployment option.',
      },
      {
        id: 'hide-deploy-template',
        label: 'Template',
        category: 'Deploy Tabs',
        configKey: 'hideDeployTemplate' as const,
        hint: 'Hide the template publishing option.',
      },
      {
        id: 'disable-mcp',
        label: 'MCP Tools',
        category: 'Tools',
        configKey: 'disableMcpTools' as const,
        hint: 'Block agents from calling MCP tools.',
      },
      {
        id: 'disable-custom-tools',
        label: 'Custom Tools',
        category: 'Tools',
        configKey: 'disableCustomTools' as const,
        hint: 'Block agents from calling user-defined custom tools.',
      },
      {
        id: 'disable-skills',
        label: 'Skills',
        category: 'Tools',
        configKey: 'disableSkills' as const,
        hint: 'Block agents from loading skills.',
      },
      {
        id: 'hide-trace-spans',
        label: 'Trace Spans',
        category: 'Logs',
        configKey: 'hideTraceSpans' as const,
        hint: 'Hide per-block trace spans in logs.',
      },
      {
        id: 'disable-invitations',
        label: 'Invitations',
        category: 'Collaboration',
        configKey: 'disableInvitations' as const,
        hint: 'Prevent users from inviting others to workspaces.',
      },
      {
        id: 'hide-inbox',
        label: 'Sim Mailer',
        category: 'Features',
        configKey: 'hideInboxTab' as const,
        hint: 'Hide the Sim Mailer inbox.',
      },
      {
        id: 'disable-public-api',
        label: 'Public API',
        category: 'Features',
        configKey: 'disablePublicApi' as const,
        hint: 'Disable public API access to deployed workflows.',
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
    return JSON.stringify(viewingGroup.config) !== JSON.stringify(editingConfig)
  }, [viewingGroup.config, editingConfig])

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

  const filteredCoreBlocks = useMemo(
    () => filteredBlocks.filter((block) => block.category === 'blocks'),
    [filteredBlocks]
  )

  const filteredToolBlocks = useMemo(
    () =>
      filteredBlocks
        .filter((block) => block.category === 'tools' || block.category === 'triggers')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [filteredBlocks]
  )

  const organizationMembers = useMemo<OrganizationMemberOption[]>(() => {
    if (!roster?.members) return []
    return roster.members
      .filter((m) => m.role !== 'external')
      .map((m) => ({
        userId: m.userId,
        user: { name: m.name, email: m.email, image: m.image },
      }))
  }, [roster])

  const availableMembersToAdd = useMemo(() => {
    const existingMemberUserIds = new Set(members.map((m) => m.userId))
    return organizationMembers.filter((m) => !existingMemberUserIds.has(m.userId))
  }, [organizationMembers, members])

  const isIntegrationAllowed = useCallback(
    (blockType: string) =>
      editingConfig.allowedIntegrations === null ||
      editingConfig.allowedIntegrations.includes(blockType),
    [editingConfig.allowedIntegrations]
  )

  /**
   * Drops denied tools whose integration is no longer allowed, keeping the
   * invariant that `deniedTools` only holds tools of currently-allowed blocks.
   * Without this, disabling then re-enabling an integration would silently
   * re-apply stale per-tool denials. Tools we can't attribute to a known block
   * are preserved.
   */
  const pruneDeniedTools = useCallback(
    (allowedIntegrations: string[] | null, deniedTools: string[]) => {
      if (allowedIntegrations === null) return deniedTools
      const allowed = new Set(allowedIntegrations)
      const pruned = deniedTools.filter((toolId) => {
        const blockTypes = toolBlockTypes[toolId]
        return !blockTypes || blockTypes.some((bt) => allowed.has(bt))
      })
      return pruned.length === deniedTools.length ? deniedTools : pruned
    },
    [toolBlockTypes]
  )

  const toggleIntegration = useCallback(
    (blockType: string) => {
      setEditingConfig((prev) => {
        const current = prev.allowedIntegrations
        let nextAllowed: string[] | null
        if (current === null) {
          nextAllowed = allBlocks.map((b) => b.type).filter((t) => t !== blockType)
        } else if (current.includes(blockType)) {
          const updated = current.filter((t) => t !== blockType)
          nextAllowed = updated.length === allBlocks.length ? null : updated
        } else {
          const updated = [...current, blockType]
          nextAllowed = updated.length === allBlocks.length ? null : updated
        }
        return {
          ...prev,
          allowedIntegrations: nextAllowed,
          deniedTools: pruneDeniedTools(nextAllowed, prev.deniedTools),
        }
      })
    },
    [allBlocks, pruneDeniedTools]
  )

  /** Allow or deny a whole section's blocks at once, respecting the active filter. */
  const setBlocksAllowed = useCallback(
    (blocks: BlockConfig[], allowed: boolean) => {
      setEditingConfig((prev) => {
        const allTypes = allBlocks.map((b) => b.type)
        const current =
          prev.allowedIntegrations === null ? new Set(allTypes) : new Set(prev.allowedIntegrations)
        for (const block of blocks) {
          if (allowed) current.add(block.type)
          else current.delete(block.type)
        }
        const nextArr = allTypes.filter((t) => current.has(t))
        const nextAllowed = nextArr.length === allTypes.length ? null : nextArr
        return {
          ...prev,
          allowedIntegrations: nextAllowed,
          deniedTools: pruneDeniedTools(nextAllowed, prev.deniedTools),
        }
      })
    },
    [allBlocks, pruneDeniedTools]
  )

  const isToolAllowed = useCallback(
    (toolId: string) => !editingConfig.deniedTools.includes(toolId),
    [editingConfig.deniedTools]
  )

  const toggleTool = useCallback((toolId: string) => {
    setEditingConfig((prev) => {
      const denied = prev.deniedTools.includes(toolId)
      return {
        ...prev,
        deniedTools: denied
          ? prev.deniedTools.filter((t) => t !== toolId)
          : [...prev.deniedTools, toolId],
      }
    })
  }, [])

  const setToolsDenied = useCallback((toolIds: string[], denied: boolean) => {
    setEditingConfig((prev) => {
      if (denied) {
        const existing = new Set(prev.deniedTools)
        const additions = toolIds.filter((t) => !existing.has(t))
        if (additions.length === 0) return prev
        return { ...prev, deniedTools: [...prev.deniedTools, ...additions] }
      }
      const toRemove = new Set(toolIds)
      return { ...prev, deniedTools: prev.deniedTools.filter((t) => !toRemove.has(t)) }
    })
  }, [])

  const deniedCountByBlock = useMemo(() => {
    const denied = new Set(editingConfig.deniedTools)
    const counts: Record<string, number> = {}
    for (const block of allBlocks) {
      let count = 0
      for (const toolId of block.tools?.access ?? []) {
        if (denied.has(toolId)) count++
      }
      if (count > 0) counts[block.type] = count
    }
    return counts
  }, [editingConfig.deniedTools, allBlocks])

  const isProviderAllowed = useCallback(
    (providerId: string) =>
      editingConfig.allowedModelProviders === null ||
      editingConfig.allowedModelProviders.includes(providerId),
    [editingConfig.allowedModelProviders]
  )

  const toggleProvider = useCallback(
    (providerId: string) => {
      setEditingConfig((prev) => {
        const current = prev.allowedModelProviders
        if (current === null) {
          const allExcept = allProviderIds.filter((p) => p !== providerId)
          return { ...prev, allowedModelProviders: allExcept }
        }
        if (current.includes(providerId)) {
          const updated = current.filter((p) => p !== providerId)
          return {
            ...prev,
            allowedModelProviders: updated.length === allProviderIds.length ? null : updated,
          }
        }
        const updated = [...current, providerId]
        return {
          ...prev,
          allowedModelProviders: updated.length === allProviderIds.length ? null : updated,
        }
      })
    },
    [allProviderIds]
  )

  /** Allow or deny a set of providers at once, respecting the active search filter. */
  const setProvidersAllowed = useCallback(
    (providerIds: string[], allowed: boolean) => {
      setEditingConfig((prev) => {
        const current =
          prev.allowedModelProviders === null
            ? new Set(allProviderIds)
            : new Set(prev.allowedModelProviders)
        for (const id of providerIds) {
          if (allowed) current.add(id)
          else current.delete(id)
        }
        const nextArr = allProviderIds.filter((id) => current.has(id))
        return {
          ...prev,
          allowedModelProviders: nextArr.length === allProviderIds.length ? null : nextArr,
        }
      })
    },
    [allProviderIds]
  )

  const isModelAllowed = useCallback(
    (model: string) => {
      const normalized = model.toLowerCase()
      return !editingConfig.deniedModels.some((denied) => denied.toLowerCase() === normalized)
    },
    [editingConfig.deniedModels]
  )

  const toggleModel = useCallback((model: string) => {
    setEditingConfig((prev) => {
      const normalized = model.toLowerCase()
      const isDenied = prev.deniedModels.some((denied) => denied.toLowerCase() === normalized)
      return {
        ...prev,
        deniedModels: isDenied
          ? prev.deniedModels.filter((denied) => denied.toLowerCase() !== normalized)
          : [...prev.deniedModels, model],
      }
    })
  }, [])

  const setModelsDenied = useCallback((models: string[], denied: boolean) => {
    setEditingConfig((prev) => {
      if (denied) {
        const existing = new Set(prev.deniedModels.map((m) => m.toLowerCase()))
        const additions = models.filter((m) => !existing.has(m.toLowerCase()))
        if (additions.length === 0) return prev
        return { ...prev, deniedModels: [...prev.deniedModels, ...additions] }
      }
      const toRemove = new Set(models.map((m) => m.toLowerCase()))
      return {
        ...prev,
        deniedModels: prev.deniedModels.filter((m) => !toRemove.has(m.toLowerCase())),
      }
    })
  }, [])

  const deniedCountByProvider = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const model of editingConfig.deniedModels) {
      try {
        const providerId = getProviderFromModel(model)
        counts[providerId] = (counts[providerId] ?? 0) + 1
      } catch {
        // Unknown/blacklisted provider — omit from counts.
      }
    }
    return counts
  }, [editingConfig.deniedModels])

  const isFileShareAuthAllowed = useCallback(
    (authType: ShareAuthType) =>
      editingConfig.allowedFileShareAuthTypes === null ||
      editingConfig.allowedFileShareAuthTypes.includes(authType),
    [editingConfig.allowedFileShareAuthTypes]
  )

  const toggleFileShareAuthType = useCallback((authType: ShareAuthType) => {
    setEditingConfig((prev) => {
      const current = prev.allowedFileShareAuthTypes
      const next =
        current === null
          ? ALL_FILE_SHARE_AUTH_TYPES.filter((t) => t !== authType)
          : current.includes(authType)
            ? current.filter((t) => t !== authType)
            : [...current, authType]
      return {
        ...prev,
        allowedFileShareAuthTypes: next.length === ALL_FILE_SHARE_AUTH_TYPES.length ? null : next,
      }
    })
  }, [])

  /** Persists the editing buffer. Returns whether the save succeeded so callers can decide whether to navigate away. */
  const handleSaveConfig = useCallback(async (): Promise<boolean> => {
    try {
      await updatePermissionGroup.mutateAsync({
        id: viewingGroup.id,
        organizationId,
        config: editingConfig,
      })
      setViewingGroup((prev) => ({ ...prev, config: editingConfig }))
      return true
    } catch (error) {
      logger.error('Failed to update config', error)
      toast.error("Couldn't save changes", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
      return false
    }
  }, [viewingGroup.id, editingConfig, organizationId, updatePermissionGroup])

  const handleDiscardConfig = useCallback(() => {
    setEditingConfig({ ...viewingGroup.config })
  }, [viewingGroup.config])

  const handleBack = useCallback(() => {
    if (hasConfigChanges) {
      setShowUnsavedChanges(true)
      return
    }
    onBack()
  }, [hasConfigChanges, onBack])

  const handleScopeChange = useCallback(
    async (workspaceIds: string[]) => {
      const previous = viewingGroup
      const seq = ++scopeWriteSeqRef.current

      setViewingGroup((prev) => ({
        ...prev,
        workspaces: organizationWorkspaces.filter((ws) => workspaceIds.includes(ws.id)),
      }))
      try {
        const result = await updatePermissionGroup.mutateAsync({
          id: viewingGroup.id,
          organizationId,
          workspaceIds,
        })
        if (seq !== scopeWriteSeqRef.current) return
        setViewingGroup((prev) => ({
          ...prev,
          workspaces: organizationWorkspaces.filter((ws) =>
            result.permissionGroup.workspaceIds.includes(ws.id)
          ),
        }))
      } catch (error) {
        logger.error('Failed to update workspace scope', error)
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
      const seq = ++scopeWriteSeqRef.current
      try {
        const result = await updatePermissionGroup.mutateAsync({
          id: viewingGroup.id,
          organizationId,
          isDefault: enabled,
        })
        if (seq !== scopeWriteSeqRef.current) return
        setViewingGroup((prev) => ({
          ...prev,
          isDefault: result.permissionGroup.isDefault,
          workspaces: result.permissionGroup.isDefault
            ? []
            : organizationWorkspaces.filter((ws) =>
                result.permissionGroup.workspaceIds.includes(ws.id)
              ),
        }))
      } catch (error) {
        logger.error('Failed to toggle default group', error)
        toast.error("Couldn't update the default group", {
          description: getErrorMessage(error, 'Please try again in a moment.'),
        })
      }
    },
    [viewingGroup.id, organizationId, organizationWorkspaces, updatePermissionGroup]
  )

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
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
    [viewingGroup.id, organizationId, removeMember]
  )

  const handleOpenAddMembersModal = useCallback(() => {
    setSelectedMemberIds(new Set())
    setAddMembersError(null)
    setShowAddMembersModal(true)
  }, [])

  const handleAddSelectedMembers = useCallback(async () => {
    if (selectedMemberIds.size === 0) return
    setAddMembersError(null)
    try {
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
  }, [viewingGroup.id, organizationId, selectedMemberIds, bulkAddMembers])

  const confirmDelete = useCallback(async () => {
    try {
      await deletePermissionGroup.mutateAsync({
        permissionGroupId: viewingGroup.id,
        organizationId,
      })
      setShowDeleteConfirm(false)
      onDeleted()
    } catch (error) {
      logger.error('Failed to delete permission group', error)
      toast.error("Couldn't delete group", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }
  }, [viewingGroup.id, organizationId, deletePermissionGroup, onDeleted])

  const tabs = useMemo(
    () => [
      { value: 'general' as const, label: 'General' },
      { value: 'providers' as const, label: 'Model Providers' },
      { value: 'blocks' as const, label: 'Blocks' },
      { value: 'platform' as const, label: 'Platform' },
    ],
    []
  )

  const filteredProvidersAllAllowed = filteredProviders.every((id) => isProviderAllowed(id))
  const coreBlocksAllAllowed = filteredCoreBlocks.every((b) => isIntegrationAllowed(b.type))
  const toolBlocksAllAllowed = filteredToolBlocks.every((b) => isIntegrationAllowed(b.type))
  const platformAllVisible = filteredPlatformFeatures.every((f) => !editingConfig[f.configKey])

  return (
    <>
      <div className='flex h-full flex-col bg-[var(--bg)]'>
        <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
          <Chip leftIcon={ArrowLeft} onClick={handleBack}>
            Access Control
          </Chip>
          <Chip
            variant='destructive'
            onClick={() => setShowDeleteConfirm(true)}
            disabled={deletePermissionGroup.isPending}
          >
            {deletePermissionGroup.isPending ? 'Deleting...' : 'Delete'}
          </Chip>
        </div>

        <div className='flex flex-shrink-0 justify-center px-6 pb-3'>
          <div className='w-full max-w-[48rem]'>
            <ChipModalTabs
              tabs={tabs}
              value={configTab}
              onChange={(value) => setConfigTab(value as ConfigTab)}
            />
          </div>
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
          <div className='mx-auto flex w-full max-w-[48rem] flex-col gap-7 pb-6'>
            <div className='flex flex-col gap-1'>
              <h1 className='font-medium text-[var(--text-body)] text-lg'>{viewingGroup.name}</h1>
              {viewingGroup.description && (
                <p className='text-[var(--text-muted)] text-md'>{viewingGroup.description}</p>
              )}
            </div>

            {configTab === 'general' && (
              <>
                <SettingsSection label='Default group'>
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-[var(--text-muted)] text-small'>
                      Applies to everyone in the organization not assigned to another group,
                      including external workspace members
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

                {!viewingGroup.isDefault && (
                  <SettingsSection label='Members'>
                    <div className='flex flex-col gap-3'>
                      <div className='flex items-center justify-between gap-3'>
                        <span className='text-[var(--text-muted)] text-small'>
                          {members.length === 0
                            ? 'Applies to all members of its workspaces. Add members to restrict it to specific people.'
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
                      ) : (
                        members.length > 0 && (
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
                        )
                      )}
                    </div>
                  </SettingsSection>
                )}
              </>
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
                    onClick={() =>
                      setProvidersAllowed(filteredProviders, !filteredProvidersAllAllowed)
                    }
                  >
                    {filteredProvidersAllAllowed ? 'Deselect All' : 'Select All'}
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
                      isAllowed={isModelAllowed}
                      onToggle={toggleModel}
                      onSetDenied={setModelsDenied}
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
                </div>
                <div className='flex flex-col gap-4'>
                  {filteredCoreBlocks.length > 0 && (
                    <div className='flex flex-col gap-1.5'>
                      <div className='flex items-center justify-between'>
                        <span className='font-medium text-[var(--text-muted)] text-small'>
                          Core Blocks
                        </span>
                        <Chip
                          flush
                          onClick={() =>
                            setBlocksAllowed(filteredCoreBlocks, !coreBlocksAllAllowed)
                          }
                        >
                          {coreBlocksAllAllowed ? 'Deselect All' : 'Select All'}
                        </Chip>
                      </div>
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
                      <div className='flex items-center justify-between'>
                        <div className='flex items-center gap-1.5'>
                          <span className='font-medium text-[var(--text-muted)] text-small'>
                            Integrations and Triggers
                          </span>
                          <Info side='top'>
                            Allow a whole integration with its checkbox, then expand it to deny
                            specific tools while keeping the rest available.
                          </Info>
                        </div>
                        <Chip
                          flush
                          onClick={() =>
                            setBlocksAllowed(filteredToolBlocks, !toolBlocksAllAllowed)
                          }
                        >
                          {toolBlocksAllAllowed ? 'Deselect All' : 'Select All'}
                        </Chip>
                      </div>
                      <div className='flex flex-col gap-0.5'>
                        {filteredToolBlocks.map((block) => (
                          <BlockToolRow
                            key={block.type}
                            block={block}
                            isBlockAllowed={isIntegrationAllowed(block.type)}
                            onToggleBlock={() => toggleIntegration(block.type)}
                            deniedCount={deniedCountByBlock[block.type] ?? 0}
                            isAllowed={isToolAllowed}
                            onToggle={toggleTool}
                            onSetDenied={setToolsDenied}
                          />
                        ))}
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
                    onClick={() =>
                      setEditingConfig((prev) => ({
                        ...prev,
                        ...Object.fromEntries(
                          filteredPlatformFeatures.map((f) => [f.configKey, platformAllVisible])
                        ),
                      }))
                    }
                  >
                    {platformAllVisible ? 'Deselect All' : 'Select All'}
                  </Chip>
                </div>
                <div className='grid grid-cols-3 gap-x-6'>
                  {platformCategoryColumns.map((column, columnIndex) => (
                    <div key={columnIndex} className='flex flex-col gap-8'>
                      {column.map(({ category, features }) => (
                        <div key={category} className='flex flex-col gap-1.5'>
                          <span className='font-medium text-[var(--text-muted)] text-small'>
                            {category}
                          </span>
                          <div className='flex flex-col gap-0.5'>
                            {features.map((feature) => (
                              <div key={feature.id} className='flex items-center gap-1.5'>
                                <label
                                  htmlFor={feature.id}
                                  className='flex flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-[5px] transition-colors hover-hover:bg-[var(--surface-active)]'
                                >
                                  <Checkbox
                                    id={feature.id}
                                    checked={!editingConfig[feature.configKey]}
                                    onCheckedChange={(checked) =>
                                      setEditingConfig((prev) => ({
                                        ...prev,
                                        [feature.configKey]: checked !== true,
                                      }))
                                    }
                                  />
                                  <span className='font-normal text-sm'>{feature.label}</span>
                                </label>
                                <Info side='top'>{feature.hint}</Info>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className='mt-8 flex flex-col gap-1.5'>
                  <span className='font-medium text-[var(--text-muted)] text-small'>Files</span>
                  <label
                    htmlFor='disable-public-file-sharing'
                    className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-[5px] transition-colors hover-hover:bg-[var(--surface-active)]'
                  >
                    <Checkbox
                      id='disable-public-file-sharing'
                      checked={!editingConfig.disablePublicFileSharing}
                      onCheckedChange={(checked) =>
                        setEditingConfig((prev) => ({
                          ...prev,
                          disablePublicFileSharing: checked !== true,
                        }))
                      }
                    />
                    <span className='font-normal text-sm'>Public Sharing</span>
                  </label>
                  <div
                    className={cn(
                      'flex flex-col gap-1 pt-1',
                      editingConfig.disablePublicFileSharing && 'opacity-50'
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
                            disabled={editingConfig.disablePublicFileSharing}
                          />
                          <span className='font-normal text-sm'>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {hasConfigChanges && (
          <div className='flex flex-shrink-0 items-center justify-end gap-2 border-[var(--border)] border-t bg-[var(--surface-3)] px-6 py-2.5'>
            <span className='mr-auto text-[var(--text-muted)] text-small'>Unsaved changes</span>
            <Chip onClick={handleDiscardConfig} disabled={updatePermissionGroup.isPending}>
              Discard
            </Chip>
            <Chip
              variant='primary'
              onClick={handleSaveConfig}
              disabled={updatePermissionGroup.isPending}
            >
              {updatePermissionGroup.isPending ? 'Saving...' : 'Save'}
            </Chip>
          </div>
        )}
      </div>

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

      <ChipConfirmModal
        open={showDeleteConfirm}
        onOpenChange={() => setShowDeleteConfirm(false)}
        srTitle='Delete Permission Group'
        title='Delete Permission Group'
        text={[
          'Are you sure you want to delete ',
          { text: viewingGroup.name, bold: true },
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
            You have unsaved changes. Do you want to save them before leaving?
          </p>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => setShowUnsavedChanges(false)}
          secondaryActions={[
            {
              label: 'Discard Changes',
              onClick: () => {
                setShowUnsavedChanges(false)
                onBack()
              },
              variant: 'destructive',
            },
          ]}
          primaryAction={{
            label: updatePermissionGroup.isPending ? 'Saving...' : 'Save Changes',
            onClick: async () => {
              const saved = await handleSaveConfig()
              if (saved) {
                setShowUnsavedChanges(false)
                onBack()
              }
            },
            disabled: updatePermissionGroup.isPending,
          }}
        />
      </ChipModal>
    </>
  )
}
