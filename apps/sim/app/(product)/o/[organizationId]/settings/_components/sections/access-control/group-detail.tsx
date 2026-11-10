'use client'

import { useDeferredValue, useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { TextField } from '@sim/emcn/field'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { Modal } from '@sim/emcn/modal'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SearchField } from '@sim/emcn/search-field'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { Switch } from '@sim/emcn/switch'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import {
  ActionRow,
  DetailHeader,
  FieldStack,
  Muted,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { AddMembersModal } from '@/app/(product)/o/[organizationId]/settings/_components/sections/access-control/add-members-modal'
import {
  BlockToolRow,
  PermissionBulkSelect,
  type PermissionControls,
  PermissionGrid,
  PlatformPermissionRow,
  ProviderRow,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/access-control/permission-rows'
import { ProjectIssueRestrictions } from '@/app/(product)/o/[organizationId]/settings/_components/sections/access-control/project-issue-restrictions'
import {
  type AccessRequestTarget,
  agentDefaultModelIds,
  applyPermissionAccess,
  CHAT_DEPLOY_AUTH_TYPE_OPTIONS,
  createPermissionResolvers,
  type EditorModel,
  FEATURE_PERMISSION_GRIDS,
  FILE_SHARE_AUTH_TYPE_OPTIONS,
  hasPermissionConfigChanges,
  isAgentDefaultUsable,
  isFeatureInertForGroup,
  matchesStatusFilter,
  type PermissionGroup,
  type PermissionGroupAccessState,
  type PermissionGroupConfig,
  type PermissionStatusFilter,
  PLATFORM_DEFAULT_MODEL,
  platformFeatureSections,
  SIM_AUTO_MODEL_ID,
  searchPlatformFeatures,
  statusFilterOptions,
  useBulkAddPermissionGroupMembers,
  useDeletePermissionGroup,
  useGroupDetailParams,
  usePermissionEditorModel,
  usePermissionGroupMembers,
  useProviderModelLists,
  useRemovePermissionGroupMember,
  useUpdatePermissionGroup,
} from '@/platform/lib/data/access-control'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import { plural } from '@/platform/shared/plural'
import { compareText, formatTimestamp } from '@/platform/shared/time'

const TABS = [
  { value: 'general', label: 'General' },
  { value: 'providers', label: 'Model Providers' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'platform', label: 'Platform' },
] as const

function StatusFilter({
  value,
  onChange,
}: {
  value: PermissionStatusFilter
  onChange: (value: PermissionStatusFilter) => void
}) {
  return (
    <ChoiceMenu
      label='Filter by access'
      value={value}
      options={statusFilterOptions(value)}
      onValueChange={(next) => onChange(next as PermissionStatusFilter)}
    />
  )
}

interface AgentDefaultProps {
  config: PermissionGroupConfig
  model: EditorModel
  hosted: boolean
  onChange: (value: string | null) => void
}

/** An allowed default for new Agent blocks governed by this group. */
function AgentDefault({ config, model, hosted, onChange }: AgentDefaultProps) {
  const dynamicModels = useProviderModelLists(
    model.dynamicProviderIds.filter((provider) =>
      model.providerIds.includes(provider)
    ) as Parameters<typeof useProviderModelLists>[0],
    undefined
  )
  const { autoAllowed, models } = agentDefaultModelIds({
    config,
    providerIds: model.providerIds,
    staticModels: model.providerModels,
    dynamicModels,
    hosted,
    facts: model.facts,
  })
  const saved = config.defaultAgentModel
  const options = [
    { label: 'Platform default', value: PLATFORM_DEFAULT_MODEL },
    ...(autoAllowed ? [{ label: 'Auto', value: SIM_AUTO_MODEL_ID }] : []),
    ...models.map((id) => ({ label: id, value: id })),
  ]
  const usable = isAgentDefaultUsable(
    config,
    { hosted, providerIds: model.providerIds },
    model.facts
  )
  return (
    <SearchableSelect
      label='Agent default'
      searchLabel='Select a model'
      placeholder='Select a model'
      options={options}
      value={saved ?? PLATFORM_DEFAULT_MODEL}
      selectedLabel={saved === SIM_AUTO_MODEL_ID ? 'Auto' : (saved ?? 'Platform default')}
      error={usable ? undefined : 'Agent default must be an available, allowed model'}
      onValueChange={(next) => {
        if (next) onChange(next === PLATFORM_DEFAULT_MODEL ? null : next)
      }}
    />
  )
}

interface GroupDetailProps {
  group: PermissionGroup
  organizationId: string
  hosted: boolean
  projectsEnabled: boolean
  workspaceOptions: { value: string; label: string }[]
  workspacesLoading: boolean
  onBack: () => void
}

/**
 * One permission group. Owns its editing buffer, scope and default writes, and members. The group
 * itself is the organization's group list as the query holds it, optimistic writes included.
 */
export function GroupDetail({
  group,
  organizationId,
  hosted,
  projectsEnabled,
  workspaceOptions,
  workspacesLoading,
  onBack,
}: GroupDetailProps) {
  const updateGroup = useUpdatePermissionGroup()
  const deleteGroup = useDeletePermissionGroup()
  const removeMember = useRemovePermissionGroupMember()
  const bulkAddMembers = useBulkAddPermissionGroupMembers()
  const params = useGroupDetailParams()
  const editor = usePermissionEditorModel(organizationId)
  const model = editor.model
  const members = usePermissionGroupMembers(organizationId, group.id)

  const [editingConfig, setEditingConfig] = useState<PermissionGroupConfig>({ ...group.config })
  const [editingName, setEditingName] = useState(group.name.trim())
  const [editingDescription, setEditingDescription] = useState((group.description ?? '').trim())
  const [addingMembers, setAddingMembers] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const controls: PermissionControls | null = model
    ? {
        ...createPermissionResolvers(editingConfig, model.accessCatalog),
        onSet: (targets: AccessRequestTarget[], state: PermissionGroupAccessState) =>
          setEditingConfig((previous) =>
            applyPermissionAccess(previous, targets, state, model.accessCatalog)
          ),
      }
    : null

  const isAgentDefaultValid = model
    ? isAgentDefaultUsable(editingConfig, { hosted, providerIds: model.providerIds }, model.facts)
    : true
  const hasConfigChanges = hasPermissionConfigChanges(group.config, editingConfig)
  // Compared trimmed: an older row may hold untrimmed text and would otherwise open dirty.
  const trimmedName = editingName.trim()
  const trimmedDescription = editingDescription.trim()
  const nameChanged = trimmedName !== group.name.trim()
  const descriptionChanged = trimmedDescription !== (group.description ?? '').trim()
  const hasChanges = hasConfigChanges || nameChanged || descriptionChanged

  function discard() {
    setEditingConfig({ ...group.config })
    setEditingName(group.name.trim())
    setEditingDescription((group.description ?? '').trim())
  }
  const guard = useSettingsUnsavedGuard({
    isDirty: hasChanges,
    navigationBlocked: updateGroup.isPending || deleteGroup.isPending,
    onDiscard: discard,
  })

  async function save() {
    if (!trimmedName || !isAgentDefaultValid) return
    try {
      await updateGroup.mutateAsync({
        id: group.id,
        organizationId,
        ...(hasConfigChanges && { config: editingConfig }),
        ...(nameChanged && { name: trimmedName }),
        ...(descriptionChanged && { description: trimmedDescription || null }),
      })
    } catch (error) {
      toast.error("Couldn't save changes", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }
  }

  async function changeScope(workspaceIds: string[]) {
    try {
      await updateGroup.mutateAsync({ id: group.id, organizationId, workspaceIds })
    } catch (error) {
      toast.error("Couldn't update workspaces", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }
  }

  async function toggleDefault(enabled: boolean) {
    try {
      await updateGroup.mutateAsync({ id: group.id, organizationId, isDefault: enabled })
    } catch (error) {
      toast.error("Couldn't update the default group", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }
  }

  async function removeGroupMember(memberId: string) {
    try {
      await removeMember.mutateAsync({ organizationId, permissionGroupId: group.id, memberId })
    } catch (error) {
      toast.error("Couldn't remove member", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }
  }

  const memberList = members.data ?? []
  const { search, status } = params
  const deferredSearch = useDeferredValue(search)
  const query = deferredSearch.trim().toLowerCase()

  function catalogBody() {
    if (editor.isLoading) return null
    if (!model || !controls) {
      return (
        <FailureNotice
          message={getErrorMessage(editor.error, 'Could not load provider availability')}
          retrying={editor.retrying}
          onRetry={editor.retry}
        />
      )
    }
    if (params.tab === 'providers') {
      if (editor.providers.isLoading) return null
      if (editor.providers.error)
        return (
          <FailureNotice
            message={getErrorMessage(
              editor.providers.error,
              'Could not load provider availability'
            )}
            retrying={editor.providers.retrying}
            onRetry={editor.providers.retry}
          />
        )
      const filtered = model.providerIds
        .filter((id) => !query || id.toLowerCase().includes(query))
        .filter((id) => matchesStatusFilter(status, controls.getState({ kind: 'provider', id })))
      return (
        <SectionStack>
          <SettingsSection title='Agent default'>
            <FieldStack>
              <AgentDefault
                config={editingConfig}
                model={model}
                hosted={hosted}
                onChange={(defaultAgentModel) =>
                  setEditingConfig((previous) => ({ ...previous, defaultAgentModel }))
                }
              />
            </FieldStack>
          </SettingsSection>
          <SectionToolbar
            grow={
              <SearchField
                key='providers'
                label='Search providers'
                placeholder='Search providers…'
                value={search}
                onValueChange={params.setSearch}
              />
            }
          >
            <StatusFilter value={status} onChange={params.setStatus} />
            <PermissionBulkSelect
              targets={filtered.map((id) => ({ kind: 'provider', id }))}
              controls={controls}
            />
          </SectionToolbar>
          {filtered.length === 0 ? (
            <Muted>No providers match your filters.</Muted>
          ) : (
            <SettingsSection title='Providers'>
              {filtered.map((providerId) => (
                <ProviderRow
                  key={providerId}
                  providerId={providerId}
                  model={model}
                  controls={controls}
                />
              ))}
            </SettingsSection>
          )}
        </SectionStack>
      )
    }
    if (params.tab === 'blocks') {
      const filtered = model.visibleBlocks
        .filter((block) => !query || block.name.toLowerCase().includes(query))
        .filter((block) =>
          matchesStatusFilter(status, controls.getState({ kind: 'integration', id: block.type }))
        )
      const core = filtered.filter((block) => block.category === 'blocks')
      const tools = filtered
        .filter((block) => block.category === 'tools' || block.category === 'triggers')
        .sort((a, b) => compareText(a.name, b.name))
      const targets = (list: typeof filtered): AccessRequestTarget[] =>
        list.map((block) => ({ kind: 'integration', id: block.type }))
      return (
        <SectionStack>
          <SectionToolbar
            grow={
              <SearchField
                key='blocks'
                label='Search blocks'
                placeholder='Search blocks…'
                value={search}
                onValueChange={params.setSearch}
              />
            }
          >
            <StatusFilter value={status} onChange={params.setStatus} />
          </SectionToolbar>
          {core.length === 0 && tools.length === 0 && <Muted>No blocks match your filters.</Muted>}
          {core.length > 0 && (
            <SettingsSection title='Core Blocks'>
              <SettingsRow label='All core blocks'>
                <PermissionBulkSelect targets={targets(core)} controls={controls} />
              </SettingsRow>
              {core.map((block) => (
                <BlockToolRow key={block.type} block={block} controls={controls} />
              ))}
            </SettingsSection>
          )}
          {tools.length > 0 && (
            <SettingsSection title='Integrations and Triggers'>
              <SettingsRow
                label='All integrations and triggers'
                description='Choose access for an integration, then expand it to set individual tools. Parent restrictions apply to every tool.'
              >
                <PermissionBulkSelect targets={targets(tools)} controls={controls} />
              </SettingsRow>
              {tools.map((block) => (
                <BlockToolRow key={block.type} block={block} controls={controls} />
              ))}
            </SettingsSection>
          )}
        </SectionStack>
      )
    }
    const features = searchPlatformFeatures(deferredSearch).filter((feature) =>
      matchesStatusFilter(
        status,
        controls.getState({ kind: 'feature', configKey: feature.configKey })
      )
    )
    const sections = platformFeatureSections(features)
    const editable = features.filter(
      (feature) =>
        !isFeatureInertForGroup(feature, group.isDefault) &&
        !controls.isInherited({ kind: 'feature', configKey: feature.configKey })
    )
    const gridFor = (featureId: string) => {
      const kind = FEATURE_PERMISSION_GRIDS[featureId as keyof typeof FEATURE_PERMISSION_GRIDS]
      if (!kind) return undefined
      const items =
        kind === 'chat_deploy_auth'
          ? CHAT_DEPLOY_AUTH_TYPE_OPTIONS
          : kind === 'file_share_auth'
            ? FILE_SHARE_AUTH_TYPE_OPTIONS
            : model.knowledgeConnectors
      return (
        <PermissionGrid
          items={items.map(({ value, label }) => ({ id: value, label }))}
          kind={kind}
          searchLabel={
            kind === 'knowledge_connector' ? 'Search connectors…' : 'Search authentication modes…'
          }
          emptyLabel={
            kind === 'knowledge_connector' ? 'No connectors available.' : 'No modes available.'
          }
          controls={controls}
        />
      )
    }
    return (
      <SectionStack>
        <SectionToolbar
          grow={
            <SearchField
              key='platform'
              label='Search features'
              placeholder='Search features…'
              value={search}
              onValueChange={params.setSearch}
            />
          }
        >
          <StatusFilter value={status} onChange={params.setStatus} />
          <PermissionBulkSelect
            targets={editable.map((feature) => ({ kind: 'feature', configKey: feature.configKey }))}
            controls={controls}
          />
        </SectionToolbar>
        {sections.length === 0 && <Muted>No features match your filters.</Muted>}
        {sections.map(({ category, features: rows }) => (
          <SettingsSection key={category} title={category}>
            {rows.map((feature) => (
              <PlatformPermissionRow
                key={feature.id}
                feature={feature}
                inert={isFeatureInertForGroup(feature, group.isDefault)}
                controls={controls}
              >
                {gridFor(feature.id)}
              </PlatformPermissionRow>
            ))}
          </SettingsSection>
        ))}
        <ProjectIssueRestrictions
          organizationId={organizationId}
          projectsEnabled={projectsEnabled}
          value={editingConfig.deniedPartialAccessProjectIssues}
          onChange={(value) =>
            setEditingConfig((previous) => ({
              ...previous,
              deniedPartialAccessProjectIssues: value,
            }))
          }
        />
      </SectionStack>
    )
  }

  return (
    <>
      <DetailHeader
        backLabel='Permission groups'
        onBack={() => guard.guardBack(onBack)}
        title={group.name}
        description={group.description ?? undefined}
      />
      <SegmentedControl
        label='Permission group settings'
        options={TABS}
        value={params.tab}
        onSelect={params.selectTab}
      />
      {params.tab !== 'general' && (
        <Muted>
          Allowed permits use. Can request requires admin approval. Unavailable blocks both.
          Workspace roles and deployment settings still apply.
        </Muted>
      )}
      {params.tab === 'general' ? (
        <SectionStack>
          <SettingsSection title='Details'>
            <FieldStack>
              <TextField
                label='Name'
                placeholder='e.g., Marketing Team'
                maxLength={100}
                value={editingName}
                onChange={setEditingName}
                error={!trimmedName ? 'Name is required.' : undefined}
              />
              <TextField
                label='Description'
                placeholder='e.g., Limited access for marketing users'
                maxLength={500}
                value={editingDescription}
                onChange={setEditingDescription}
              />
            </FieldStack>
          </SettingsSection>
          <SettingsSection title='Default group'>
            <SettingsRow
              label='Organization default'
              description='Applies to everyone in the organization not assigned to another group, including external workspace members'
            >
              <Switch
                label='Organization default'
                checked={group.isDefault}
                disabled={updateGroup.isPending}
                onCheckedChange={(checked) => void toggleDefault(checked)}
              />
            </SettingsRow>
          </SettingsSection>
          <SettingsSection title='Workspaces'>
            {group.isDefault ? (
              <SettingsRow label='Governs every workspace in the organization' />
            ) : (
              <>
                <FieldStack>
                  <MultiSelect
                    label={
                      group.workspaces.length > 0
                        ? `Governs ${plural(group.workspaces.length, 'workspace')}`
                        : 'Select the workspaces this group governs'
                    }
                    searchLabel='Search workspaces…'
                    placeholder='Select workspaces…'
                    options={workspaceOptions}
                    value={group.workspaces.map((ws) => ws.id)}
                    disabled={workspacesLoading}
                    onValueChange={(ids) => void changeScope(ids)}
                  />
                </FieldStack>
                {group.workspaces.map((ws) => (
                  <SettingsRow key={ws.id} label={ws.name} />
                ))}
              </>
            )}
          </SettingsSection>
          {!group.isDefault && (
            <SettingsSection title='Members'>
              <SettingsRow
                label={
                  members.isPending || members.error
                    ? 'Members'
                    : memberList.length === 0
                      ? group.membershipMode === 'inherit'
                        ? 'Applies to all members of its workspaces. Add members to restrict it to specific people.'
                        : 'No members assigned.'
                      : `Restricted to ${plural(memberList.length, 'member')}`
                }
              >
                <Button
                  variant='primary'
                  size='compact'
                  icon='I074'
                  disabled={members.data === undefined}
                  onClick={() => setAddingMembers(true)}
                >
                  Add
                </Button>
              </SettingsRow>
              {members.isPending ? null : members.data === undefined ? (
                <FailureNotice
                  message={getErrorMessage(members.error, 'Failed to load members')}
                  retrying={members.isFetching}
                  onRetry={() => void members.refetch()}
                />
              ) : (
                memberList.map((member) => {
                  const name = member.userName || member.userEmail || 'Unknown'
                  return (
                    <SettingsRow
                      key={member.id}
                      label={name}
                      description={`${member.userEmail || name} · Added ${formatTimestamp(new Date(member.assignedAt).getTime())}`}
                      leading={<Avatar name={name} src={member.userImage ?? undefined} />}
                    >
                      <ActionMenu
                        label={`${name} actions`}
                        icon='I108'
                        actions={[
                          {
                            id: 'remove',
                            label: 'Remove',
                            destructive: true,
                            onSelect: () => void removeGroupMember(member.id),
                          },
                        ]}
                      />
                    </SettingsRow>
                  )
                })
              )}
            </SettingsSection>
          )}
        </SectionStack>
      ) : (
        catalogBody()
      )}
      <SettingsSection title='Manage'>
        <SettingsRow label='Group settings'>
          <ActionRow>
            {hasChanges && (
              <Button variant='quiet' disabled={updateGroup.isPending} onClick={discard}>
                Discard
              </Button>
            )}
            <Button
              variant='primary'
              disabled={
                !hasChanges || updateGroup.isPending || !trimmedName || !isAgentDefaultValid
              }
              onClick={() => void save()}
            >
              {updateGroup.isPending ? 'Saving…' : 'Save'}
            </Button>
          </ActionRow>
        </SettingsRow>
        <SettingsRow label='Delete permission group'>
          <Button
            variant='quiet'
            destructive
            disabled={deleteGroup.isPending}
            onClick={() => setConfirmingDelete(true)}
          >
            {deleteGroup.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </SettingsRow>
      </SettingsSection>
      {addingMembers && (
        <AddMembersModal
          organizationId={organizationId}
          existingUserIds={memberList.map((member) => member.userId)}
          onClose={() => setAddingMembers(false)}
          onAdd={async (userIds) => {
            await bulkAddMembers.mutateAsync({
              organizationId,
              permissionGroupId: group.id,
              userIds,
            })
          }}
          isAdding={bulkAddMembers.isPending}
        />
      )}
      <Modal
        variant='confirm'
        destructive
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title='Delete permission group'
        description={`Are you sure you want to delete ${group.name}? All members will be removed from this group. This action cannot be undone.`}
        confirmLabel={deleteGroup.isPending ? 'Deleting…' : 'Delete'}
        onConfirm={async () => {
          await deleteGroup.mutateAsync({ permissionGroupId: group.id, organizationId })
          onBack()
        }}
      />
    </>
  )
}
