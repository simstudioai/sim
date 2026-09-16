'use client'

import { type ReactNode, useCallback, useId, useMemo, useRef, useState } from 'react'
import {
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
  ChipTag,
  cn,
  Info,
  OverflowText,
  Search,
  Skeleton,
  Switch,
  toast,
} from '@sim/emcn'
import { ArrowLeft, ChevronDown, Plus } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { formatDate } from '@sim/utils/formatting'
import { useQueryState } from 'nuqs'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import type { ShareAuthType } from '@/lib/api/contracts/public-shares'
import { isAccessControlAllowlistRow } from '@/lib/permission-groups/block-access'
import {
  isFeatureInertForGroup,
  ORGANIZATION_SCOPED_FEATURE_NOTE,
  PLATFORM_CATEGORY_ORDER,
  PLATFORM_FEATURES,
} from '@/lib/permission-groups/features'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import { UnsavedChangesModal } from '@/app/workspace/[workspaceId]/components/credential-detail'
import {
  groupSearchParam,
  groupSearchUrlKeys,
  groupStatusParam,
  groupStatusUrlKeys,
  groupTabParam,
  groupTabUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import {
  MemberAvatar,
  MemberRow,
} from '@/app/workspace/[workspaceId]/settings/components/member-list'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useSettingsUnsavedGuard } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard'
import { getAllBlocks } from '@/blocks'
import { useCustomBlockOverlayVersion } from '@/blocks/custom/client-overlay'
import type { BlockConfig } from '@/blocks/types'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
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
import {
  allowlistRowsFromStored,
  toggleAllowlistRow,
  withAllowlistRows,
} from '@/ee/access-control/utils/integration-allowlist-rows'
import { SettingRow } from '@/ee/components/setting-row'
import { useBlacklistedProviders } from '@/hooks/queries/allowed-providers'
import { useOrganizationRoster } from '@/hooks/queries/organization'
import { useProviderModels } from '@/hooks/queries/providers'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import {
  DYNAMIC_MODEL_PROVIDERS,
  getProviderModels,
  PROVIDER_DEFINITIONS,
} from '@/providers/models'
import type { ProviderId } from '@/providers/types'
import { getAllProviderIds, getProviderFromModel } from '@/providers/utils'
import type { ProviderName } from '@/stores/providers'
import { getToolMetadata } from '@/tools/metadata'

const logger = createLogger('AccessControlGroupDetail')

type ConfigTab = 'general' | 'providers' | 'blocks' | 'platform'

/** Hoisted: rebuilding this per comparison allocated once per sort step. */
const BLOCK_CATEGORY_ORDER: Record<string, number> = { triggers: 0, blocks: 1, tools: 2 }

/** Public-file-share auth modes an admin can allow/disallow. `null` config = all allowed. */
const FILE_SHARE_AUTH_TYPE_OPTIONS: { value: ShareAuthType; label: string }[] = [
  { value: 'public', label: 'Anyone with link' },
  { value: 'password', label: 'Password' },
  { value: 'email', label: 'Email' },
  { value: 'sso', label: 'SSO' },
]
const ALL_FILE_SHARE_AUTH_TYPES: ShareAuthType[] = FILE_SHARE_AUTH_TYPE_OPTIONS.map((o) => o.value)

/** Chat-deployment auth modes an admin can allow/disallow. `null` config = all allowed. */
const CHAT_DEPLOY_AUTH_TYPE_OPTIONS: { value: ShareAuthType; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'password', label: 'Password' },
  { value: 'email', label: 'Email' },
  { value: 'sso', label: 'SSO' },
]
const ALL_CHAT_DEPLOY_AUTH_TYPES: ShareAuthType[] = CHAT_DEPLOY_AUTH_TYPE_OPTIONS.map(
  (o) => o.value
)

/**
 * Knowledge base connectors an admin can allow or disallow. `null` config = all
 * allowed. Sorted by display name because the picker is read alphabetically,
 * while the registry is keyed by the snake_case id the server stores. Reads
 * {@link CONNECTOR_META_REGISTRY}, the client-safe metadata half of the
 * connector split.
 */
const KNOWLEDGE_CONNECTOR_OPTIONS: { value: string; label: string }[] = Object.values(
  CONNECTOR_META_REGISTRY
)
  .map((meta) => ({ value: meta.id, label: meta.name }))
  .sort((a, b) => a.label.localeCompare(b.label))

type StatusFilter = 'all' | 'enabled' | 'disabled'

const ALL_KNOWLEDGE_CONNECTORS: string[] = KNOWLEDGE_CONNECTOR_OPTIONS.map((o) => o.value)

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Show all' },
  { value: 'enabled', label: 'Show enabled' },
  { value: 'disabled', label: 'Show disabled' },
]

function matchesStatusFilter(filter: StatusFilter, enabled: boolean) {
  return filter === 'all' || (filter === 'enabled') === enabled
}

interface StatusFilterChipProps {
  value: StatusFilter
  onChange: (value: StatusFilter) => void
}

/** The All/Enabled/Disabled narrowing control shared by the three list tabs. */
function StatusFilterChip({ value, onChange }: StatusFilterChipProps) {
  return (
    <ChipDropdown
      value={value}
      onChange={(next) => onChange(next as StatusFilter)}
      options={STATUS_FILTER_OPTIONS}
      matchTriggerWidth={false}
      className='w-[140px] shrink-0'
    />
  )
}

interface AllowlistFieldProps {
  label: string
  value: string[]
  onChange: (values: string[]) => void
  options: { value: string; label: string }[]
  disabled: boolean
}

/**
 * The allowed-values multi-select nested under a platform toggle. Dims and
 * disables together with the toggle that owns it. The left padding lines both
 * children up with the parent's label text — row gutter (8) + checkbox (16) +
 * gap (8) = 32 — so the field reads as subordinate rather than as a sibling row.
 */
function AllowlistField({ label, value, onChange, options, disabled }: AllowlistFieldProps) {
  const labelId = useId()
  const triggerId = useId()
  return (
    <div className={cn('flex flex-col gap-1.5 pt-1 pr-2 pb-2 pl-8', disabled && 'opacity-50')}>
      <span id={labelId} className='text-[var(--text-muted)] text-caption'>
        {label}
      </span>
      <ChipDropdown
        multiple
        showAllOption={false}
        id={triggerId}
        // Both ids: `aria-labelledby` replaces the content-derived name, so
        // naming it with the label alone would drop the selected value.
        aria-labelledby={`${labelId} ${triggerId}`}
        value={value}
        onChange={onChange}
        options={options}
        disabled={disabled}
        // An empty allow-list denies every option, so the multi-select's default
        // empty label — 'All' — states the opposite of what the server enforces.
        allLabel='None allowed'
        matchTriggerWidth={false}
        className='w-[200px]'
      />
    </div>
  )
}

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
          <ChipModalField type='custom' title='Members' submitOnEnter={false}>
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
                  <SettingsEmptyState variant='inline'>
                    No members found matching "{searchTerm}"
                  </SettingsEmptyState>
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
                          className='flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
                        >
                          <Checkbox checked={isSelected} />
                          <MemberAvatar name={name} image={member.user?.image ?? null} />
                          <div className='min-w-0 flex-1'>
                            <OverflowText
                              label={name}
                              className='block text-[var(--text-body)] text-sm'
                            />
                            <OverflowText
                              label={email}
                              className='block text-[var(--text-muted)] text-caption'
                            />
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
              <OverflowText label={item.label} className='text-sm' />
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
        <div className='relative flex size-[16px] shrink-0 items-center justify-center'>
          {ProviderIcon && <ProviderIcon className='size-[16px]!' />}
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
          <OverflowText label={providerName} className='text-sm' />
          {isProviderAllowed && deniedCount > 0 && (
            <ChipTag variant='gray' className='shrink-0'>
              {deniedCount} blocked
            </ChipTag>
          )}
          {isProviderAllowed && (
            <ChevronDown
              className={cn(
                'ml-auto size-[14px] shrink-0 text-[var(--text-icon)] transition-transform',
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
    () => (block.tools?.access ?? []).map((id) => ({ id, label: getToolMetadata(id)?.name ?? id })),
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
          className='relative flex size-[16px] shrink-0 items-center justify-center overflow-hidden rounded-sm'
          style={{ background: block.bgColor }}
        >
          {BlockIcon && <BlockIcon className='size-[9px]! text-white' />}
        </div>
        <button
          type='button'
          onClick={() => isBlockAllowed && isExpandable && setExpanded((prev) => !prev)}
          disabled={!isBlockAllowed || !isExpandable}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 text-left',
            isBlockAllowed && isExpandable ? 'cursor-pointer' : 'cursor-default',
            !isBlockAllowed && 'opacity-60'
          )}
        >
          <OverflowText label={block.name} className='text-sm' />
          {/* An org running one custom block per environment has prod/uat/sandbox copies
              sharing a name and differing only by an opaque type slug. The source workspace
              is the only thing that tells them apart, so an allowlist decision made without
              it is a guess. */}
          {block.sourceWorkspaceName && (
            <span className='shrink-0 text-[var(--text-muted)] text-caption'>
              {block.sourceWorkspaceName}
            </span>
          )}
          {isBlockAllowed && deniedCount > 0 && (
            <ChipTag variant='gray' className='shrink-0'>
              {deniedCount} blocked
            </ChipTag>
          )}
          {isBlockAllowed && isExpandable && (
            <ChevronDown
              className={cn(
                'ml-auto size-[14px] shrink-0 text-[var(--text-icon)] transition-transform',
                expanded && 'rotate-180'
              )}
            />
          )}
        </button>
        {/* Outside the button: an Info trigger is itself a button and cannot nest. */}
        {block.description && (
          <Info side='top' className={cn('shrink-0', !isBlockAllowed && 'opacity-60')}>
            {block.description}
          </Info>
        )}
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
   * from the prop for this keyed group instance, so
   * optimistic scope/default/config writes are not clobbered by list refetches.
   */
  const [viewingGroup, setViewingGroup] = useState<PermissionGroup>(group)
  const [editingConfig, setEditingConfig] = useState<PermissionGroupConfig>({ ...group.config })
  const [editingName, setEditingName] = useState(group.name.trim())
  const [editingDescription, setEditingDescription] = useState((group.description ?? '').trim())

  /**
   * Monotonic token for scope-affecting writes (workspace select + default
   * toggle). Only the most recent write may reconcile or revert the local
   * group, so rapid multi-select toggles can't settle on a stale response.
   */
  const scopeWriteSeqRef = useRef(0)

  // Tab, search, and status filter are shareable detail-view state, so they live
  // in the URL (see .claude/rules/sim-url-state.md). The three tabs never render
  // together, so search and status share one param each rather than carrying
  // three mutually-exclusive keys; switching tabs resets both.
  const [configTab, setConfigTab] = useQueryState(groupTabParam.key, {
    ...groupTabParam.parser,
    ...groupTabUrlKeys,
  })
  const [searchTerm, setSearchTermParam] = useQueryState(groupSearchParam.key, {
    ...groupSearchParam.parser,
    ...groupSearchUrlKeys,
  })
  const setSearchTerm = useDebouncedSearchSetter(setSearchTermParam)
  const [statusFilter, setStatusFilter] = useQueryState(groupStatusParam.key, {
    ...groupStatusParam.parser,
    ...groupStatusUrlKeys,
  })

  const handleTabChange = useCallback(
    (value: string) => {
      void setConfigTab(value as ConfigTab)
      // Don't carry a provider query or an enabled-only filter into another tab.
      setSearchTerm('')
      void setStatusFilter(null)
    },
    [setConfigTab, setSearchTerm, setStatusFilter]
  )

  const [showAddMembersModal, setShowAddMembersModal] = useState(false)
  const [addMembersError, setAddMembersError] = useState<string | null>(null)
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(() => new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const { data: members = [], isPending: membersLoading } = usePermissionGroupMembers(
    organizationId,
    viewingGroup.id
  )
  const { data: roster } = useOrganizationRoster(organizationId)
  const { data: blacklistedProvidersData } = useBlacklistedProviders({ enabled: true })

  // Recompute when custom (deploy-as-block) blocks or the viewer's block
  // visibility hydrate into the overlay.
  const customBlockOverlayVersion = useCustomBlockOverlayVersion()

  /**
   * The allowlist UNIVERSE: every access-controllable block, INCLUDING blocks
   * gated for this viewer (they arrive as clones with `hideFromToolbar: true`,
   * clone-not-remove). Materialization and the collapse-to-null comparison in
   * `toggleIntegration`/`setBlocksAllowed` must use this viewer-independent set —
   * otherwise a null→partial transition by a non-revealed admin would silently
   * drop a preview block from the stored allowlist and deny it to revealed
   * users already running it.
   *
   * EXCLUDES superseded blocks. They are hidden and so are never rendered, but
   * they used to be materialized into the allowlist all the same — so an admin
   * narrowing a previously-unrestricted allowlist by unchecking `slack_v2` wrote
   * `slack` into it, which the runtime resolves back to `slack_v2` and allows.
   * A decision about a retired version is made on its successor's row.
   */
  const allBlocks = useMemo(() => {
    const blocks = getAllBlocks().filter((b) => isAccessControlAllowlistRow(b.type))
    return blocks.sort((a, b) => {
      const catA = BLOCK_CATEGORY_ORDER[a.category] ?? 3
      const catB = BLOCK_CATEGORY_ORDER[b.category] ?? 3
      if (catA !== catB) return catA - catB
      return a.name.localeCompare(b.name)
    })
  }, [customBlockOverlayVersion])

  /**
   * The RENDERED list: hides blocks gated for this viewer by reading the
   * registry projection's effective flag off the clone (the single source of
   * truth — never re-derive visibility here). Revealed viewers see preview
   * blocks (with their " (Preview)" suffix) and can toggle them explicitly.
   */
  const visibleBlocks = useMemo(() => allBlocks.filter((b) => !b.hideFromToolbar), [allBlocks])

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

  const searchedPlatformFeatures = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()
    if (!search) return PLATFORM_FEATURES
    return PLATFORM_FEATURES.filter(
      (f) => f.label.toLowerCase().includes(search) || f.category.toLowerCase().includes(search)
    )
  }, [searchTerm])

  /** Split from the search pass for the same reason as the provider and block lists. */
  const filteredPlatformFeatures = useMemo(() => {
    if (statusFilter === 'all') return searchedPlatformFeatures
    return searchedPlatformFeatures.filter((f) =>
      matchesStatusFilter(statusFilter, !editingConfig[f.configKey])
    )
  }, [searchedPlatformFeatures, statusFilter, editingConfig])

  const platformCategories = useMemo(() => {
    const categories: Record<string, (typeof PLATFORM_FEATURES)[number][]> = {}
    for (const feature of filteredPlatformFeatures) {
      if (!categories[feature.category]) {
        categories[feature.category] = []
      }
      categories[feature.category].push(feature)
    }
    return categories
  }, [filteredPlatformFeatures])

  const platformCategorySections = useMemo(() => {
    const known = PLATFORM_CATEGORY_ORDER.filter((c) => platformCategories[c]?.length)
    const extras = Object.keys(platformCategories).filter(
      (c) => !PLATFORM_CATEGORY_ORDER.includes(c) && platformCategories[c]?.length
    )
    return [...known, ...extras].map((category) => ({
      category,
      features: platformCategories[category] ?? [],
    }))
  }, [platformCategories])

  const hasConfigChanges = useMemo(() => {
    return JSON.stringify(viewingGroup.config) !== JSON.stringify(editingConfig)
  }, [viewingGroup.config, editingConfig])

  // Both buffers are seeded trimmed and compared against a trimmed baseline. The
  // contract trims name and description on write, but a row stored before those
  // schemas gained `.trim()` (or written straight to the API) can still carry
  // padding — compared raw it would open dirty with no way to clear it, since
  // Discard restores the same padded value.
  const trimmedName = editingName.trim()
  const trimmedDescription = editingDescription.trim()
  const nameChanged = trimmedName !== viewingGroup.name.trim()
  const descriptionChanged = trimmedDescription !== (viewingGroup.description ?? '').trim()
  const hasChanges = hasConfigChanges || nameChanged || descriptionChanged

  const guard = useSettingsUnsavedGuard({ isDirty: hasChanges })

  const allBlockTypes = useMemo(() => allBlocks.map((b) => b.type), [allBlocks])

  /**
   * `null` means "everything allowed". Indexing the allow-lists once keeps the
   * per-row membership checks O(1) — they run for every one of the ~200 block
   * rows on each render, and again in the section-wide `every(...)` scans.
   */
  const allowedIntegrationSet = useMemo(
    () => allowlistRowsFromStored(allBlockTypes, editingConfig.allowedIntegrations),
    [allBlockTypes, editingConfig.allowedIntegrations]
  )

  const allowedProviderSet = useMemo(
    () =>
      editingConfig.allowedModelProviders === null
        ? null
        : new Set(editingConfig.allowedModelProviders),
    [editingConfig.allowedModelProviders]
  )

  const isIntegrationAllowed = useCallback(
    (blockType: string) => allowedIntegrationSet === null || allowedIntegrationSet.has(blockType),
    [allowedIntegrationSet]
  )

  const isProviderAllowed = useCallback(
    (providerId: string) => allowedProviderSet === null || allowedProviderSet.has(providerId),
    [allowedProviderSet]
  )

  const searchedProviders = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return allProviderIds
    return allProviderIds.filter((id) => id.toLowerCase().includes(query))
  }, [allProviderIds, searchTerm])

  /**
   * Split from the search pass so the common `all` case returns the searched
   * list by reference — only the status pass depends on the allow-list, so a
   * checkbox toggle no longer invalidates downstream consumers.
   */
  const filteredProviders = useMemo(() => {
    if (statusFilter === 'all') return searchedProviders
    return searchedProviders.filter((id) =>
      matchesStatusFilter(statusFilter, isProviderAllowed(id))
    )
  }, [searchedProviders, statusFilter, isProviderAllowed])

  const searchedBlocks = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return visibleBlocks
    return visibleBlocks.filter((b) => b.name.toLowerCase().includes(query))
  }, [visibleBlocks, searchTerm])

  const filteredBlocks = useMemo(() => {
    if (statusFilter === 'all') return searchedBlocks
    return searchedBlocks.filter((b) =>
      matchesStatusFilter(statusFilter, isIntegrationAllowed(b.type))
    )
  }, [searchedBlocks, statusFilter, isIntegrationAllowed])

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
        const nextAllowed = toggleAllowlistRow(allBlockTypes, prev.allowedIntegrations, blockType)
        return {
          ...prev,
          allowedIntegrations: nextAllowed,
          deniedTools: pruneDeniedTools(nextAllowed, prev.deniedTools),
        }
      })
    },
    [allBlockTypes, pruneDeniedTools]
  )

  /** Allow or deny a whole section's blocks at once, respecting the active filter. */
  const setBlocksAllowed = useCallback(
    (blocks: BlockConfig[], allowed: boolean) => {
      setEditingConfig((prev) => {
        const nextAllowed = withAllowlistRows(
          allBlockTypes,
          prev.allowedIntegrations,
          blocks.map((block) => block.type),
          allowed
        )
        return {
          ...prev,
          allowedIntegrations: nextAllowed,
          deniedTools: pruneDeniedTools(nextAllowed, prev.deniedTools),
        }
      })
    },
    [allBlockTypes, pruneDeniedTools]
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
      } catch {}
    }
    return counts
  }, [editingConfig.deniedModels])

  const fileShareAuthValue = useMemo(
    () => editingConfig.allowedFileShareAuthTypes ?? ALL_FILE_SHARE_AUTH_TYPES,
    [editingConfig.allowedFileShareAuthTypes]
  )

  const setFileShareAuthTypes = useCallback((values: string[]) => {
    // At least one mode must stay allowed while public sharing is enabled — an
    // empty allow-list would silently block every share. To turn public sharing
    // off entirely, uncheck Public Sharing instead.
    if (values.length === 0) return
    setEditingConfig((prev) => ({
      ...prev,
      allowedFileShareAuthTypes:
        values.length === ALL_FILE_SHARE_AUTH_TYPES.length ? null : (values as ShareAuthType[]),
    }))
  }, [])

  const chatDeployAuthValue = useMemo(
    () => editingConfig.allowedChatDeployAuthTypes ?? ALL_CHAT_DEPLOY_AUTH_TYPES,
    [editingConfig.allowedChatDeployAuthTypes]
  )

  const setChatDeployAuthTypes = useCallback((values: string[]) => {
    // At least one mode must stay allowed while chat deploy is enabled — an empty
    // allow-list would silently block every chat deployment. To turn chat deploy
    // off entirely, uncheck Chat → Deployment instead.
    if (values.length === 0) return
    setEditingConfig((prev) => ({
      ...prev,
      allowedChatDeployAuthTypes:
        values.length === ALL_CHAT_DEPLOY_AUTH_TYPES.length ? null : (values as ShareAuthType[]),
    }))
  }, [])

  const knowledgeConnectorValue = useMemo(
    () => editingConfig.allowedKnowledgeConnectors ?? ALL_KNOWLEDGE_CONNECTORS,
    [editingConfig.allowedKnowledgeConnectors]
  )

  /**
   * At least one connector must stay allowed while the Knowledge Base module is
   * visible — an empty allow-list would silently block every connector while
   * the add-connector button still offered them. To withhold connectors along
   * with the rest of the module, uncheck Knowledge Base instead.
   */
  const setKnowledgeConnectors = useCallback((values: string[]) => {
    if (values.length === 0) return
    setEditingConfig((prev) => ({
      ...prev,
      allowedKnowledgeConnectors: values.length === ALL_KNOWLEDGE_CONNECTORS.length ? null : values,
    }))
  }, [])

  /**
   * Nested controls rendered under a platform feature's checkbox, keyed by
   * feature id. Kept out of `PLATFORM_FEATURES` so that array stays pure data.
   */
  const featureExtras: Partial<Record<string, ReactNode>> = {
    'hide-deploy-chatbot': (
      <AllowlistField
        label='Auth modes chat deployments may use'
        value={chatDeployAuthValue}
        onChange={setChatDeployAuthTypes}
        options={CHAT_DEPLOY_AUTH_TYPE_OPTIONS}
        disabled={editingConfig.hideDeployChatbot}
      />
    ),
    'disable-public-file-sharing': (
      <AllowlistField
        label='Auth modes public file-share links may use'
        value={fileShareAuthValue}
        onChange={setFileShareAuthTypes}
        options={FILE_SHARE_AUTH_TYPE_OPTIONS}
        disabled={editingConfig.disablePublicFileSharing}
      />
    ),
    /**
     * Nested under Knowledge Base rather than Knowledge Base Creation: a
     * connector attaches to an existing knowledge base, so the allow-list still
     * governs a group that may sync but never create. Hanging it off creation
     * would dim the picker for exactly the group it was written for.
     */
    'hide-knowledge-base': (
      <AllowlistField
        label='Connectors knowledge bases may sync from'
        value={knowledgeConnectorValue}
        onChange={setKnowledgeConnectors}
        options={KNOWLEDGE_CONNECTOR_OPTIONS}
        disabled={editingConfig.hideKnowledgeBaseTab}
      />
    ),
  }

  /** Persists the editing buffer — name/description are only sent when they changed. */
  const handleSaveConfig = async () => {
    if (!trimmedName) return
    try {
      const result = await updatePermissionGroup.mutateAsync({
        id: viewingGroup.id,
        organizationId,
        ...(hasConfigChanges && { config: editingConfig }),
        ...(nameChanged && { name: trimmedName }),
        ...(descriptionChanged && { description: trimmedDescription || null }),
      })
      // Reconcile from the server's copy, like the scope/default writes do, so a
      // server-side normalization can't leave the dirty check comparing against a
      // baseline that was never persisted. Editing buffers are left alone so
      // in-flight edits survive and correctly re-mark the form dirty.
      const saved = result.permissionGroup
      setViewingGroup((prev) => ({
        ...prev,
        config: saved.config,
        name: saved.name,
        description: saved.description,
      }))
    } catch (error) {
      logger.error('Failed to save permission group', error)
      toast.error("Couldn't save changes", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }
  }

  const handleDiscardConfig = () => {
    setEditingConfig({ ...viewingGroup.config })
    setEditingName(viewingGroup.name.trim())
    setEditingDescription((viewingGroup.description ?? '').trim())
  }

  const handleBack = useCallback(() => {
    guard.guardBack(onBack)
  }, [guard.guardBack, onBack])

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
  /**
   * Rows this group cannot decide: an organization-scoped key is read from the
   * organization's *default* group, so setting it on any other group changes
   * nothing. They render inert, and every bulk action skips them — "Select All"
   * writing a value the server would never read is the same false promise as
   * the checkbox itself.
   */
  const editablePlatformFeatures = useMemo(
    () =>
      filteredPlatformFeatures.filter((f) => !isFeatureInertForGroup(f, viewingGroup.isDefault)),
    [filteredPlatformFeatures, viewingGroup.isDefault]
  )

  const platformAllAllowed = editablePlatformFeatures.every((f) => !editingConfig[f.configKey])

  return (
    <>
      <SettingsPanel
        back={{ text: 'Access control', icon: ArrowLeft, onSelect: handleBack }}
        title={viewingGroup.name}
        description={viewingGroup.description ?? undefined}
        actions={[
          ...saveDiscardActions({
            dirty: hasChanges,
            saving: updatePermissionGroup.isPending,
            onSave: handleSaveConfig,
            onDiscard: handleDiscardConfig,
            saveDisabled: !trimmedName,
          }),
          {
            id: 'delete',
            text: deletePermissionGroup.isPending ? 'Deleting...' : 'Delete',
            onSelect: () => setShowDeleteConfirm(true),
            disabled: deletePermissionGroup.isPending,
          },
        ]}
      >
        <div className='sticky top-0 z-10 bg-[var(--bg)]'>
          <ChipModalTabs tabs={tabs} value={configTab} onChange={handleTabChange} />
        </div>

        {configTab === 'general' && (
          <>
            <SettingsSection label='Details'>
              <div className='flex flex-col gap-4'>
                <SettingRow label='Name' error={!trimmedName ? 'Name is required.' : undefined}>
                  <ChipInput
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    placeholder='e.g., Marketing Team'
                    maxLength={100}
                    error={!trimmedName}
                  />
                </SettingRow>
                <SettingRow label='Description'>
                  <ChipInput
                    value={editingDescription}
                    onChange={(e) => setEditingDescription(e.target.value)}
                    placeholder='e.g., Limited access for marketing users'
                    maxLength={500}
                  />
                </SettingRow>
              </div>
            </SettingsSection>

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
                      className='shrink-0'
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
                      className='shrink-0'
                    >
                      Add
                    </Chip>
                  </div>
                  {membersLoading ? (
                    <div className='-mx-2 flex flex-col gap-y-0.5'>
                      {[1, 2].map((i) => (
                        <div key={i} className='flex items-center gap-2.5 p-2'>
                          <Skeleton className='size-[14px] shrink-0 rounded-full' />
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
                            status={`Added ${formatDate(new Date(member.assignedAt))}`}
                            menu={
                              <RowActionsMenu
                                label='Member actions'
                                actions={[
                                  {
                                    label: 'Remove',
                                    onSelect: () => handleRemoveMember(member.id),
                                    destructive: true,
                                  },
                                ]}
                              />
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
          <div className='flex flex-col gap-7'>
            <div className='flex items-center gap-2'>
              <ChipInput
                icon={Search}
                placeholder='Search providers...'
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className='min-w-0 flex-1'
              />
              <StatusFilterChip
                value={statusFilter}
                onChange={(next) => void setStatusFilter(next)}
              />
              <Chip
                onClick={() => setProvidersAllowed(filteredProviders, !filteredProvidersAllAllowed)}
                disabled={filteredProviders.length === 0}
              >
                {filteredProvidersAllAllowed ? 'Deselect All' : 'Select All'}
              </Chip>
            </div>
            {filteredProviders.length === 0 ? (
              <SettingsEmptyState variant='inline'>
                No providers match your filters.
              </SettingsEmptyState>
            ) : (
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
            )}
          </div>
        )}

        {configTab === 'blocks' && (
          <div className='flex flex-col gap-7'>
            <div className='flex items-center gap-2'>
              <ChipInput
                icon={Search}
                placeholder='Search blocks...'
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className='min-w-0 flex-1'
              />
              <StatusFilterChip
                value={statusFilter}
                onChange={(next) => void setStatusFilter(next)}
              />
            </div>
            {filteredCoreBlocks.length === 0 && filteredToolBlocks.length === 0 && (
              <SettingsEmptyState variant='inline'>
                No blocks match your filters.
              </SettingsEmptyState>
            )}
            {filteredCoreBlocks.length > 0 && (
              <SettingsSection
                label='Core Blocks'
                action={
                  <Chip onClick={() => setBlocksAllowed(filteredCoreBlocks, !coreBlocksAllAllowed)}>
                    {coreBlocksAllAllowed ? 'Deselect All' : 'Select All'}
                  </Chip>
                }
              >
                <div className='grid grid-cols-3 gap-x-2 gap-y-0.5'>
                  {filteredCoreBlocks.map((block) => {
                    const BlockIcon = block.icon
                    const checkboxId = `block-${block.type}`
                    return (
                      <div
                        key={block.type}
                        className='flex items-center gap-1.5 rounded-md pr-2 transition-colors hover-hover:bg-[var(--surface-active)]'
                      >
                        <label
                          htmlFor={checkboxId}
                          className='flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-[5px] pl-2'
                        >
                          <Checkbox
                            id={checkboxId}
                            checked={isIntegrationAllowed(block.type)}
                            onCheckedChange={() => toggleIntegration(block.type)}
                          />
                          <div
                            className='relative flex size-[16px] shrink-0 items-center justify-center overflow-hidden rounded-sm'
                            style={{ background: block.bgColor }}
                          >
                            {BlockIcon && <BlockIcon className='size-[9px]! text-white' />}
                          </div>
                          <OverflowText label={block.name} className='text-sm' />
                          {block.sourceWorkspaceName && (
                            <span className='shrink-0 text-[var(--text-muted)] text-caption'>
                              {block.sourceWorkspaceName}
                            </span>
                          )}
                        </label>
                        {block.description && (
                          <Info side='top' className='shrink-0'>
                            {block.description}
                          </Info>
                        )}
                      </div>
                    )
                  })}
                </div>
              </SettingsSection>
            )}
            {filteredToolBlocks.length > 0 && (
              <SettingsSection
                label='Integrations and Triggers'
                headerAccessory={
                  <Info side='top'>
                    Allow a whole integration with its checkbox, then expand it to deny specific
                    tools while keeping the rest available.
                  </Info>
                }
                action={
                  <Chip onClick={() => setBlocksAllowed(filteredToolBlocks, !toolBlocksAllAllowed)}>
                    {toolBlocksAllAllowed ? 'Deselect All' : 'Select All'}
                  </Chip>
                }
              >
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
              </SettingsSection>
            )}
          </div>
        )}

        {configTab === 'platform' && (
          <div className='flex flex-col gap-7'>
            <div className='flex items-center gap-2'>
              <ChipInput
                icon={Search}
                placeholder='Search features...'
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className='min-w-0 flex-1'
              />
              <StatusFilterChip
                value={statusFilter}
                onChange={(next) => void setStatusFilter(next)}
              />
              <Chip
                onClick={() =>
                  setEditingConfig((prev) => ({
                    ...prev,
                    ...Object.fromEntries(
                      editablePlatformFeatures.map((f) => [f.configKey, platformAllAllowed])
                    ),
                  }))
                }
                disabled={editablePlatformFeatures.length === 0}
              >
                {platformAllAllowed ? 'Deselect All' : 'Select All'}
              </Chip>
            </div>
            {platformCategorySections.length === 0 && (
              <SettingsEmptyState variant='inline'>
                No features match your filters.
              </SettingsEmptyState>
            )}
            {platformCategorySections.map(({ category, features }) => (
              <SettingsSection key={category} label={category}>
                <div className='flex flex-col gap-0.5'>
                  {features.map((feature) => {
                    const inert = isFeatureInertForGroup(feature, viewingGroup.isDefault)
                    return (
                      <div key={feature.id} className='flex flex-col'>
                        <div className='flex items-center gap-1.5 rounded-md pr-2 transition-colors hover-hover:bg-[var(--surface-active)]'>
                          <label
                            htmlFor={feature.id}
                            className={cn(
                              'flex flex-1 items-center gap-2 py-[5px] pl-2',
                              inert ? 'cursor-default opacity-60' : 'cursor-pointer'
                            )}
                          >
                            <Checkbox
                              id={feature.id}
                              checked={!editingConfig[feature.configKey]}
                              disabled={inert}
                              onCheckedChange={(checked) =>
                                setEditingConfig((prev) => ({
                                  ...prev,
                                  [feature.configKey]: checked !== true,
                                }))
                              }
                            />
                            <span className='font-normal text-sm'>{feature.label}</span>
                            {inert && (
                              <ChipTag variant='gray' className='shrink-0'>
                                Organization
                              </ChipTag>
                            )}
                          </label>
                          <Info side='top' className='shrink-0'>
                            {inert
                              ? `${feature.hint} ${ORGANIZATION_SCOPED_FEATURE_NOTE}`
                              : feature.hint}
                          </Info>
                        </div>
                        {featureExtras[feature.id]}
                      </div>
                    )
                  })}
                </div>
              </SettingsSection>
            ))}
          </div>
        )}
      </SettingsPanel>

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

      <UnsavedChangesModal
        open={guard.showUnsavedModal}
        onOpenChange={guard.setShowUnsavedModal}
        onDiscard={guard.confirmDiscard}
      />
    </>
  )
}
