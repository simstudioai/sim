'use client'

import { type ReactNode, useDeferredValue, useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { TextField } from '@sim/emcn/field'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import { SettingsSaveBar } from '@/app/(product)/_components/settings-parts/save-bar'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import {
  DetailHeader,
  FieldStack,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SwitchRow } from '@/app/(product)/_components/settings-parts/switch-row'
import { AddMembersModal } from '@/app/(product)/o/[organizationId]/settings/_components/sections/access-control/add-members-modal'
import { BlocksTab } from '@/app/(product)/o/[organizationId]/settings/_components/sections/access-control/blocks-tab'
import type { PermissionControls } from '@/app/(product)/o/[organizationId]/settings/_components/sections/access-control/permission-rows'
import { PlatformTab } from '@/app/(product)/o/[organizationId]/settings/_components/sections/access-control/platform-tab'
import { ProvidersTab } from '@/app/(product)/o/[organizationId]/settings/_components/sections/access-control/providers-tab'
import {
  type AccessRequestTarget,
  applyPermissionAccess,
  createPermissionResolvers,
  hasPermissionConfigChanges,
  isAgentDefaultUsable,
  type PermissionGroup,
  type PermissionGroupAccessState,
  type PermissionGroupConfig,
  useBulkAddPermissionGroupMembers,
  useDeletePermissionGroup,
  useGroupDetailParams,
  useOrganizationWorkspaces,
  usePermissionEditorModel,
  usePermissionGroupMembers,
  useRemovePermissionGroupMember,
  useUpdatePermissionGroup,
} from '@/platform/lib/data/access-control'
import { requestSettingsLeave } from '@/platform/lib/data/settings-guard'
import { plural } from '@/platform/shared/plural'
import { formatTimestamp } from '@/platform/shared/time'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'providers', label: 'Model providers' },
  { id: 'blocks', label: 'Blocks' },
  { id: 'platform', label: 'Platform' },
] as const

/** A group's reach, as its row in the list and its detail header describe it. */
export function groupSummary(group: PermissionGroup): string {
  if (group.isDefault) return 'Everyone in the organization'
  const members = group.memberCount === 0 ? 'All members' : plural(group.memberCount, 'member')
  return `${members} · ${plural(group.workspaces.length, 'workspace')}`
}

/** Everything the group's Save writes, in one request. */
interface GroupDraft {
  name: string
  description: string
  isDefault: boolean
  workspaceIds: string[]
  config: PermissionGroupConfig
}

function savedDraft(group: PermissionGroup): GroupDraft {
  return {
    // Trimmed: an older row may hold untrimmed text and would otherwise open dirty.
    name: group.name.trim(),
    description: (group.description ?? '').trim(),
    isDefault: group.isDefault,
    workspaceIds: group.workspaces.map((workspace) => workspace.id),
    config: group.config,
  }
}

function sameIds(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id) => right.includes(id))
}

interface GroupMembersProps {
  organizationId: string
  group: PermissionGroup
}

/** Who the group restricts. Adding and removing are list actions with their own dialogs. */
function GroupMembers({ organizationId, group }: GroupMembersProps) {
  const members = usePermissionGroupMembers(organizationId, group.id)
  const removeMember = useRemovePermissionGroupMember()
  const bulkAddMembers = useBulkAddPermissionGroupMembers()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)

  if (members.isPending) return null
  if (members.data === undefined) {
    return (
      <FailureNotice
        message={getErrorMessage(members.error, 'Failed to load members')}
        retrying={members.isFetching}
        onRetry={() => void members.refetch()}
      />
    )
  }
  const memberList = members.data
  const addMembers = (
    <Button size='compact' icon='I074' onClick={() => setAdding(true)}>
      Add members
    </Button>
  )
  return (
    <>
      <SettingsList
        title='Members'
        empty={
          memberList.length > 0
            ? undefined
            : group.membershipMode === 'inherit'
              ? {
                  title: 'Applies to every member of its workspaces',
                  description: 'Add members to restrict it to specific people',
                  action: addMembers,
                }
              : { title: 'No members', action: addMembers }
        }
      >
        {memberList.map((member) => {
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
                    onSelect: () => setRemoving({ id: member.id, name }),
                  },
                ]}
              />
            </SettingsRow>
          )
        })}
        <SettingsRow label='Add members' description='Restrict the group to specific people'>
          {addMembers}
        </SettingsRow>
      </SettingsList>
      {adding && (
        <AddMembersModal
          organizationId={organizationId}
          existingUserIds={memberList.map((member) => member.userId)}
          onClose={() => setAdding(false)}
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
      <ConfirmDialog
        target={removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name ?? 'member'}`}
        description={`${group.name} no longer restricts them`}
        confirmLabel='Remove'
        pendingLabel='Removing…'
        onConfirm={async () => {
          if (!removing) return
          await removeMember.mutateAsync({
            organizationId,
            permissionGroupId: group.id,
            memberId: removing.id,
          })
        }}
      />
    </>
  )
}

interface GroupDetailProps {
  group: PermissionGroup
  organizationId: string
  hosted: boolean
  projectsEnabled: boolean
  onBack: () => void
}

/**
 * One permission group, edited in place. Every field on every tab (name, description, the default
 * switch, the workspaces it governs and its permissions) is one draft that Save writes in one
 * request. Members are list actions with their own dialogs, so they apply at once. The group itself
 * is the organization's group list as the query holds it, optimistic writes included, and the draft
 * holds only what was edited, so a save that lands shows the server's group.
 */
export function GroupDetail({
  group,
  organizationId,
  hosted,
  projectsEnabled,
  onBack,
}: GroupDetailProps) {
  const updateGroup = useUpdatePermissionGroup()
  const deleteGroup = useDeletePermissionGroup()
  const workspaces = useOrganizationWorkspaces(organizationId)
  const params = useGroupDetailParams()
  const editor = usePermissionEditorModel(organizationId)
  const model = editor.model
  const [edits, setEdits] = useState<Partial<GroupDraft>>({})
  const [attempted, setAttempted] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const deferredSearch = useDeferredValue(params.search)
  const query = deferredSearch.trim().toLowerCase()

  const saved = savedDraft(group)
  const draft: GroupDraft = { ...saved, ...edits }
  const edit = (patch: Partial<GroupDraft>) => setEdits((previous) => ({ ...previous, ...patch }))
  const editConfig = (change: (config: PermissionGroupConfig) => PermissionGroupConfig) =>
    setEdits((previous) => ({ ...previous, config: change(previous.config ?? group.config) }))

  const changes = {
    name: draft.name.trim() !== saved.name,
    description: draft.description.trim() !== saved.description,
    isDefault: draft.isDefault !== saved.isDefault,
    workspaceIds: !draft.isDefault && !sameIds(draft.workspaceIds, saved.workspaceIds),
    config: hasPermissionConfigChanges(group.config, draft.config),
  }
  const dirty = Object.values(changes).some(Boolean)
  const nameError = attempted && !draft.name.trim() ? 'Name is required' : undefined
  const agentDefaultUsable = model
    ? isAgentDefaultUsable(draft.config, { hosted, providerIds: model.providerIds }, model.facts)
    : true

  const controls: PermissionControls | null = model
    ? {
        ...createPermissionResolvers(draft.config, model.accessCatalog),
        onSet: (targets: AccessRequestTarget[], state: PermissionGroupAccessState) =>
          editConfig((config) =>
            applyPermissionAccess(config, targets, state, model.accessCatalog)
          ),
      }
    : null

  async function save() {
    setAttempted(true)
    if (!draft.name.trim() || !agentDefaultUsable) return
    const sent = edits
    try {
      await updateGroup.mutateAsync({
        id: group.id,
        organizationId,
        ...(changes.name && { name: draft.name.trim() }),
        ...(changes.description && { description: draft.description.trim() || null }),
        ...(changes.isDefault && { isDefault: draft.isDefault }),
        ...(changes.workspaceIds && { workspaceIds: draft.workspaceIds }),
        ...(changes.config && { config: draft.config }),
      })
      // Keeps an edit made while the save was in flight.
      setEdits((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key, value]) => sent[key as keyof GroupDraft] !== value)
        )
      )
      setAttempted(false)
      toast.success('Permission group saved')
    } catch (error) {
      toast.error('Couldn’t save changes', {
        description: getErrorMessage(error, 'Try again in a moment'),
      })
    }
  }

  /** A catalog tab, once the editor's model has loaded. */
  const catalog = (
    render: (model: NonNullable<typeof editor.model>, controls: PermissionControls) => ReactNode
  ) => {
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
    return render(model, controls)
  }

  const general = (
    <SectionStack>
      <SettingsSection title='Details'>
        <FieldStack>
          <TextField
            label='Name'
            placeholder='e.g., Marketing Team'
            maxLength={100}
            value={draft.name}
            onChange={(name) => edit({ name })}
            error={nameError}
          />
          <TextField
            label='Description'
            optional
            placeholder='e.g., Limited access for marketing users'
            maxLength={500}
            value={draft.description}
            onChange={(description) => edit({ description })}
          />
        </FieldStack>
      </SettingsSection>
      <SettingsSection title='Scope'>
        <SwitchRow
          label='Organization default'
          description='Applies to everyone in the organization not assigned to another group, including external workspace members'
          checked={draft.isDefault}
          onCheckedChange={(isDefault) => edit({ isDefault })}
        />
        <FieldStack>
          <MultiSelect
            label='Workspaces'
            searchLabel='Search workspaces…'
            placeholder={draft.isDefault ? 'All workspaces' : 'Select workspaces…'}
            options={(workspaces.data ?? []).map((workspace) => ({
              value: workspace.id,
              label: workspace.name,
            }))}
            value={draft.isDefault ? [] : draft.workspaceIds}
            disabled={draft.isDefault || workspaces.data === undefined}
            onValueChange={(workspaceIds) => edit({ workspaceIds })}
          />
          {workspaces.isLoadingError && (
            <FailureNotice
              message={getErrorMessage(workspaces.error, 'Failed to load workspaces')}
              retrying={workspaces.isFetching}
              onRetry={() => void workspaces.refetch()}
            />
          )}
        </FieldStack>
      </SettingsSection>
      {!group.isDefault && <GroupMembers organizationId={organizationId} group={group} />}
    </SectionStack>
  )

  const tabContent = {
    general,
    providers: catalog((model, controls) => (
      <ProvidersTab
        model={model}
        controls={controls}
        config={draft.config}
        hosted={hosted}
        providers={editor.providers}
        search={params.search}
        query={query}
        status={params.status}
        onSearchChange={params.setSearch}
        onStatusChange={params.setStatus}
        onAgentDefaultChange={(defaultAgentModel) =>
          editConfig((config) => ({ ...config, defaultAgentModel }))
        }
      />
    )),
    blocks: catalog((model, controls) => (
      <BlocksTab
        model={model}
        controls={controls}
        search={params.search}
        query={query}
        status={params.status}
        onSearchChange={params.setSearch}
        onStatusChange={params.setStatus}
      />
    )),
    platform: catalog((model, controls) => (
      <PlatformTab
        organizationId={organizationId}
        projectsEnabled={projectsEnabled}
        isDefaultGroup={group.isDefault}
        model={model}
        controls={controls}
        deniedProjectIssues={draft.config.deniedPartialAccessProjectIssues}
        search={params.search}
        deferredSearch={deferredSearch}
        status={params.status}
        onSearchChange={params.setSearch}
        onStatusChange={params.setStatus}
        onDeniedProjectIssuesChange={(deniedPartialAccessProjectIssues) =>
          editConfig((config) => ({ ...config, deniedPartialAccessProjectIssues }))
        }
      />
    )),
  }

  return (
    <SectionStack>
      <DetailHeader
        backLabel='Permission groups'
        onBack={() => requestSettingsLeave(onBack)}
        title={group.name}
        description={groupSummary(group)}
      />
      <ContentTabs
        label='Permission group settings'
        current={params.tab}
        onSelect={(id) => {
          const tab = TABS.find((candidate) => candidate.id === id)
          if (tab) params.selectTab(tab.id)
        }}
        items={TABS.map((tab) => ({
          id: tab.id,
          label: tab.label,
          content: params.tab === tab.id ? tabContent[tab.id] : null,
        }))}
      />
      <SettingsSaveBar
        dirty={dirty}
        saving={updateGroup.isPending}
        blocked={Boolean(nameError) || !agentDefaultUsable}
        onSave={() => void save()}
        onDiscard={() => {
          setEdits({})
          setAttempted(false)
        }}
      />
      <SettingsSection title='Manage group'>
        <SettingsRow
          label='Delete permission group'
          description='Remove this group and its restrictions'
        >
          <Button variant='quiet' destructive onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        </SettingsRow>
      </SettingsSection>
      <ConfirmDialog
        target={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title={`Delete ${group.name}`}
        description='Its members lose these restrictions. This can’t be undone'
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={async () => {
          await deleteGroup.mutateAsync({ permissionGroupId: group.id, organizationId })
          onBack()
        }}
      />
    </SectionStack>
  )
}
