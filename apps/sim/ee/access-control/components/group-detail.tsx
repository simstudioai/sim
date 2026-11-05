'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Avatar,
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
  Info,
  OverflowText,
  Skeleton,
  Switch,
  toast,
} from '@sim/emcn'
import { ArrowLeft, Plus, Search } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { formatDate } from '@sim/utils/formatting'
import { useQueryState } from 'nuqs'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { isFeatureInertForGroup } from '@/lib/permission-groups/features'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import { resolveAgentDefaultModel } from '@/lib/permission-groups/model-access'
import {
  groupSearchParam,
  groupSearchUrlKeys,
  groupStatusParam,
  groupStatusUrlKeys,
  groupTabParam,
  groupTabUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import { MemberRow } from '@/app/workspace/[workspaceId]/settings/components/member-list'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useCustomBlockOverlayVersion } from '@/blocks/custom/client-overlay'
import { AgentDefault } from '@/ee/access-control/components/agent-default'
import {
  BlockToolRow,
  PermissionBulkSelect,
  PermissionGrid,
  PlatformPermissionRow,
  ProviderRow,
} from '@/ee/access-control/components/permission-rows'
import { ProjectIssueRestrictions } from '@/ee/access-control/components/project-issue-restrictions'
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
  applyPermissionAccess,
  CHAT_DEPLOY_AUTH_TYPE_OPTIONS,
  createEditorCatalog,
  createPermissionResolvers,
  FILE_SHARE_AUTH_TYPE_OPTIONS,
  hasPermissionConfigChanges,
  matchesStatusFilter,
  type PermissionStatusFilter,
  platformFeatureSections,
  searchPlatformFeatures,
  statusFilterOptions,
} from '@/ee/access-control/lib/editor'
import {
  getAccessControlBlockUniverse,
  KNOWLEDGE_CONNECTOR_OPTIONS,
} from '@/ee/access-control/lib/editor-registry'
import type {
  AccessRequestTarget,
  PermissionGroupAccessState,
} from '@/ee/access-requests/lib/targets'
import { SettingRow } from '@/ee/components/setting-row'
import { useBlacklistedProviders } from '@/hooks/queries/allowed-providers'
import { useOrganizationRoster } from '@/hooks/queries/organization'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'
import { getStaticProviderModels, PROVIDER_DEFINITIONS } from '@/providers/models'
import { getAllProviderIds } from '@/providers/utils'

const logger = createLogger('AccessControlGroupDetail')

type ConfigTab = 'general' | 'providers' | 'blocks' | 'platform'

type StatusFilter = PermissionStatusFilter

interface StatusFilterChipProps {
  value: StatusFilter
  onChange: (value: StatusFilter) => void
}

function StatusFilterChip({ value, onChange }: StatusFilterChipProps) {
  return (
    <ChipDropdown
      value={value}
      onChange={(next) => onChange(next as StatusFilter)}
      options={statusFilterOptions(value)}
      matchTriggerWidth={false}
      className='w-[140px] shrink-0 max-sm:min-w-0 max-sm:flex-1'
    />
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
              <div className='flex flex-wrap items-center gap-2'>
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
                          <Avatar size='xs' name={name} src={member.user?.image} aria-hidden />
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
  const { hosted } = useDeploymentShape()
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
  const blacklistedProviders = useBlacklistedProviders()

  // Recompute when custom (deploy-as-block) blocks or the viewer's block
  // visibility hydrate into the overlay.
  const customBlockOverlayVersion = useCustomBlockOverlayVersion()

  /** See {@link getAccessControlBlockUniverse}. */
  const allBlocks = useMemo(() => getAccessControlBlockUniverse(), [customBlockOverlayVersion])

  /**
   * The RENDERED list: hides blocks gated for this viewer by reading the
   * registry projection's effective flag off the clone (the single source of
   * truth — never re-derive visibility here). Revealed viewers see preview
   * blocks (with their " (Preview)" suffix) and can toggle them explicitly.
   */
  const visibleBlocks = useMemo(() => allBlocks.filter((b) => !b.hideFromToolbar), [allBlocks])

  const allProviderIds = useMemo(() => {
    if (!blacklistedProviders.isSuccess) return []
    const blacklist = blacklistedProviders.data.blacklistedProviders
    return getAllProviderIds().filter((id) => !blacklist.includes(id.toLowerCase()))
  }, [blacklistedProviders.data, blacklistedProviders.isSuccess])
  const isAgentDefaultValid =
    !editingConfig.defaultAgentModel ||
    !!resolveAgentDefaultModel(editingConfig, {
      allowAuto: hosted,
      availableProviderIds: allProviderIds,
    })

  const editorCatalog = useMemo(
    () =>
      createEditorCatalog({
        blocks: allBlocks.map((block) => ({
          type: block.type,
          name: block.name,
          toolIds: block.tools?.access ?? [],
        })),
        providers: allProviderIds.map((id) => ({
          id,
          label: PROVIDER_DEFINITIONS[id]?.name ?? id,
          modelIds: getStaticProviderModels(id)
            .filter((model) => model.sunset?.status !== 'deprecated')
            .map((model) => model.id),
        })),
        knowledgeConnectors: KNOWLEDGE_CONNECTOR_OPTIONS,
      }),
    [allBlocks, allProviderIds]
  )

  const { getState, isInherited, getInheritedFrom, canRequest } = useMemo(
    () => createPermissionResolvers(editingConfig, editorCatalog),
    [editingConfig, editorCatalog]
  )

  const setAccess = (targets: AccessRequestTarget[], state: PermissionGroupAccessState) => {
    setEditingConfig((previous) => applyPermissionAccess(previous, targets, state, editorCatalog))
  }

  const controls = { getState, isInherited, getInheritedFrom, canRequest, onSet: setAccess }

  const searchedPlatformFeatures = useMemo(() => searchPlatformFeatures(searchTerm), [searchTerm])

  /** Split from the search pass for the same reason as the provider and block lists. */
  const filteredPlatformFeatures = useMemo(() => {
    if (statusFilter === 'all') return searchedPlatformFeatures
    return searchedPlatformFeatures.filter((f) =>
      matchesStatusFilter(statusFilter, getState({ kind: 'feature', configKey: f.configKey }))
    )
  }, [searchedPlatformFeatures, statusFilter, getState])

  const platformCategorySections = useMemo(
    () => platformFeatureSections(filteredPlatformFeatures),
    [filteredPlatformFeatures]
  )

  const hasConfigChanges = hasPermissionConfigChanges(viewingGroup.config, editingConfig)

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

  const guard = useSettingsUnsavedGuard({
    isDirty: hasChanges,
    navigationBlocked: updatePermissionGroup.isPending || deletePermissionGroup.isPending,
    onDiscard: () => handleDiscardConfig(),
  })

  const searchedProviders = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return allProviderIds
    return allProviderIds.filter((id) => id.toLowerCase().includes(query))
  }, [allProviderIds, searchTerm])

  const filteredProviders = useMemo(() => {
    if (statusFilter === 'all') return searchedProviders
    return searchedProviders.filter((id) =>
      matchesStatusFilter(statusFilter, getState({ kind: 'provider', id }))
    )
  }, [searchedProviders, statusFilter, getState])

  const searchedBlocks = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return visibleBlocks
    return visibleBlocks.filter((b) => b.name.toLowerCase().includes(query))
  }, [visibleBlocks, searchTerm])

  const filteredBlocks = useMemo(() => {
    if (statusFilter === 'all') return searchedBlocks
    return searchedBlocks.filter((b) =>
      matchesStatusFilter(statusFilter, getState({ kind: 'integration', id: b.type }))
    )
  }, [searchedBlocks, statusFilter, getState])

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

  const featureExtras = {
    'hide-deploy-chatbot': (
      <PermissionGrid
        items={CHAT_DEPLOY_AUTH_TYPE_OPTIONS.map(({ value, label }) => ({ id: value, label }))}
        kind='chat_deploy_auth'
        searchPlaceholder='Search authentication modes...'
        emptyLabel='No modes available.'
        {...controls}
      />
    ),
    'disable-public-file-sharing': (
      <PermissionGrid
        items={FILE_SHARE_AUTH_TYPE_OPTIONS.map(({ value, label }) => ({ id: value, label }))}
        kind='file_share_auth'
        searchPlaceholder='Search authentication modes...'
        emptyLabel='No modes available.'
        {...controls}
      />
    ),
    'hide-knowledge-base': (
      <PermissionGrid
        items={KNOWLEDGE_CONNECTOR_OPTIONS.map(({ value, label }) => ({ id: value, label }))}
        kind='knowledge_connector'
        searchPlaceholder='Search connectors...'
        emptyLabel='No connectors available.'
        {...controls}
      />
    ),
  }

  /** Persists the editing buffer — name/description are only sent when they changed. */
  const handleSaveConfig = async () => {
    if (!trimmedName || !isAgentDefaultValid) return
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

  const editablePlatformFeatures = filteredPlatformFeatures.filter(
    (feature) =>
      !isFeatureInertForGroup(feature, viewingGroup.isDefault) &&
      !isInherited({ kind: 'feature', configKey: feature.configKey })
  )

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
            saveDisabled: !trimmedName || !isAgentDefaultValid,
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

        {configTab !== 'general' && (
          <p className='text-[var(--text-muted)] text-sm'>
            Allowed permits use. Can request requires admin approval. Unavailable blocks both.
            Workspace roles and deployment settings still apply.
          </p>
        )}

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
                        ? group.membershipMode === 'inherit'
                          ? 'Applies to all members of its workspaces. Add members to restrict it to specific people.'
                          : 'No members assigned.'
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

        {configTab === 'providers' &&
          (blacklistedProviders.isError ? (
            <SettingsQueryErrorState
              error={blacklistedProviders.error}
              fallback='Could not load provider availability'
              isRetrying={blacklistedProviders.isFetching}
              onRetry={() => void blacklistedProviders.refetch()}
              variant='inline'
            />
          ) : !blacklistedProviders.isSuccess ? (
            <SettingsEmptyState variant='inline'>Loading providers</SettingsEmptyState>
          ) : (
            <div className='flex flex-col gap-7'>
              <AgentDefault
                config={editingConfig}
                providerIds={allProviderIds}
                workspaceId={workspaceId}
                onChange={(defaultAgentModel) =>
                  setEditingConfig((prev) => ({ ...prev, defaultAgentModel }))
                }
              />
              <div className='flex flex-wrap items-center gap-2'>
                <ChipInput
                  icon={Search}
                  placeholder='Search providers...'
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className='min-w-0 basis-full sm:flex-1 sm:basis-0'
                />
                <StatusFilterChip
                  value={statusFilter}
                  onChange={(next) => void setStatusFilter(next)}
                />
                <PermissionBulkSelect
                  targets={filteredProviders.map((id) => ({ kind: 'provider', id }))}
                  {...controls}
                />
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
                      workspaceId={workspaceId}
                      {...controls}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}

        {configTab === 'blocks' && (
          <div className='flex flex-col gap-7'>
            <div className='flex flex-wrap items-center gap-2'>
              <ChipInput
                icon={Search}
                placeholder='Search blocks...'
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className='min-w-0 basis-full sm:flex-1 sm:basis-0'
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
                  <PermissionBulkSelect
                    targets={filteredCoreBlocks.map((block) => ({
                      kind: 'integration',
                      id: block.type,
                    }))}
                    {...controls}
                  />
                }
              >
                <div className='flex flex-col gap-0.5'>
                  {filteredCoreBlocks.map((block) => (
                    <BlockToolRow key={block.type} block={block} {...controls} />
                  ))}
                </div>
              </SettingsSection>
            )}
            {filteredToolBlocks.length > 0 && (
              <SettingsSection
                label='Integrations and Triggers'
                headerAccessory={
                  <Info side='top' label='About integration and trigger permissions'>
                    Choose access for an integration, then expand it to set individual tools. Parent
                    restrictions apply to every tool.
                  </Info>
                }
                action={
                  <PermissionBulkSelect
                    targets={filteredToolBlocks.map((block) => ({
                      kind: 'integration',
                      id: block.type,
                    }))}
                    {...controls}
                  />
                }
              >
                <div className='flex flex-col gap-0.5'>
                  {filteredToolBlocks.map((block) => (
                    <BlockToolRow key={block.type} block={block} {...controls} />
                  ))}
                </div>
              </SettingsSection>
            )}
          </div>
        )}

        {configTab === 'platform' && (
          <div className='flex flex-col gap-7'>
            <div className='flex flex-wrap items-center gap-2'>
              <ChipInput
                icon={Search}
                placeholder='Search features...'
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className='min-w-0 basis-full sm:flex-1 sm:basis-0'
              />
              <StatusFilterChip
                value={statusFilter}
                onChange={(next) => void setStatusFilter(next)}
              />
              <PermissionBulkSelect
                targets={editablePlatformFeatures.map((feature) => ({
                  kind: 'feature',
                  configKey: feature.configKey,
                }))}
                {...controls}
              />
            </div>
            {platformCategorySections.length === 0 && (
              <SettingsEmptyState variant='inline'>
                No features match your filters.
              </SettingsEmptyState>
            )}
            {platformCategorySections.map(({ category, features }) => (
              <SettingsSection
                key={category}
                label={<span className='flex h-[30px] items-center'>{category}</span>}
              >
                <div className='flex flex-col gap-0.5'>
                  {features.map((feature) => (
                    <PlatformPermissionRow
                      key={feature.id}
                      feature={feature}
                      inert={isFeatureInertForGroup(feature, viewingGroup.isDefault)}
                      {...controls}
                    >
                      {feature.id in featureExtras
                        ? featureExtras[feature.id as keyof typeof featureExtras]
                        : undefined}
                    </PlatformPermissionRow>
                  ))}
                </div>
              </SettingsSection>
            ))}
            <ProjectIssueRestrictions
              organizationId={organizationId}
              value={editingConfig.deniedPartialAccessProjectIssues}
              onChange={(value) =>
                setEditingConfig((previous) => ({
                  ...previous,
                  deniedPartialAccessProjectIssues: value,
                }))
              }
            />
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
    </>
  )
}
