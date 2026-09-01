'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipModalTabs, toast } from '@sim/emcn'
import { ArrowLeft, Plus, User } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import { McpIcon } from '@/components/icons'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import type {
  CredentialGroupEnrollment,
  CredentialGroupEnrollmentConnection,
  CredentialGroupEnrollmentMcpConnection,
} from '@/lib/api/contracts/credential-groups'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import { getCredentialGroupProviderService } from '@/lib/credential-groups/providers'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import { UnsavedChangesModal } from '@/app/workspace/[workspaceId]/components/credential-detail'
import {
  credentialGroupProviderSearchParam,
  credentialGroupProviderSearchUrlKeys,
  credentialGroupTabParam,
  credentialGroupTabUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import type { SettingsAction } from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useSettingsUnsavedGuard } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard'
import {
  CredentialGroupAccess,
  useCredentialGroupAccessEditor,
} from '@/ee/credential-groups/components/credential-group-access'
import { CredentialGroupDetails } from '@/ee/credential-groups/components/credential-group-details'
import { CredentialGroupInviteModal } from '@/ee/credential-groups/components/credential-group-invite-modal'
import {
  useCredentialGroupDetail,
  useDeleteCredentialGroup,
  useDeleteCredentialGroupEnrollment,
  useResendCredentialGroupEnrollment,
  useUpdateCredentialGroup,
} from '@/hooks/queries/credential-groups'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

interface CredentialGroupDetailProps {
  workspaceId: string
  groupId: string
  onBack: () => void
}

type CredentialGroupTab = 'details' | 'people' | 'access'

const CREDENTIAL_GROUP_TABS = [
  { value: 'details', label: 'Details' },
  { value: 'people', label: 'People' },
  { value: 'access', label: 'Access' },
] as const

interface EnrollmentConnectionsProps {
  connections: CredentialGroupEnrollmentConnection[]
  mcpConnections: CredentialGroupEnrollmentMcpConnection[]
}

interface CredentialProviderIconProps {
  provider: CredentialGroupProvider
}

function CredentialProviderIcon({ provider }: CredentialProviderIconProps) {
  const ProviderIcon = getCredentialGroupProviderService(provider).icon
  return <ProviderIcon className='size-[14px]' aria-hidden />
}

function EnrollmentConnections({ connections, mcpConnections }: EnrollmentConnectionsProps) {
  const connected = connections.filter((connection) => connection.status === 'active')
  const connectedMcp = mcpConnections.filter((connection) => connection.status === 'active')
  const count =
    connected.reduce((total, connection) => total + connection.count, 0) + connectedMcp.length
  const providers = [...new Set(connected.map((connection) => connection.provider))]

  return (
    <span className='flex items-center gap-1.5'>
      {providers.map((provider) => {
        return <CredentialProviderIcon key={provider} provider={provider} />
      })}
      {connectedMcp.length > 0 ? <McpIcon className='size-[14px]' aria-hidden /> : null}
      <span>
        {count} connected {count === 1 ? 'connection' : 'connections'}
      </span>
    </span>
  )
}

export function CredentialGroupDetail({
  workspaceId,
  groupId,
  onBack,
}: CredentialGroupDetailProps) {
  const detail = useCredentialGroupDetail(workspaceId, groupId)
  const slackBots = useWorkspaceCredentials({
    workspaceId,
    type: 'service_account',
    providerId: SLACK_CUSTOM_BOT_PROVIDER_ID,
  })
  const resend = useResendCredentialGroupEnrollment()
  const deleteEnrollment = useDeleteCredentialGroupEnrollment()
  const updateGroup = useUpdateCredentialGroup()
  const deleteGroup = useDeleteCredentialGroup()
  const [activeTab, setActiveTab] = useQueryState(credentialGroupTabParam.key, {
    ...credentialGroupTabParam.parser,
    ...credentialGroupTabUrlKeys,
  })
  const accessEditor = useCredentialGroupAccessEditor({
    workspaceId,
    groupId,
    enabled: activeTab === 'access',
  })
  const [providerSearch, setProviderSearchParam] = useQueryState(
    credentialGroupProviderSearchParam.key,
    { ...credentialGroupProviderSearchParam.parser, ...credentialGroupProviderSearchUrlKeys }
  )
  const setProviderSearch = useDebouncedSearchSetter(setProviderSearchParam)
  const [showInvite, setShowInvite] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deletingEnrollmentId, setDeletingEnrollmentId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState<string | null>(null)
  const [draftDescription, setDraftDescription] = useState<string | null>(null)
  const credentialGroup = detail.data?.pages[0]?.credentialGroup
  const enrollments = detail.data?.pages.flatMap((page) => page.enrollments) ?? []
  const deletingEnrollment = deletingEnrollmentId
    ? (enrollments.find((enrollment) => enrollment.id === deletingEnrollmentId) ?? null)
    : null
  const configurationReady =
    Boolean(
      credentialGroup &&
        (credentialGroup.options.length ||
          credentialGroup.mcpServers.some(
            (server) => server.enabled && server.authType === 'oauth'
          ))
    ) &&
    credentialGroup?.options.every(
      (option) =>
        option.provider !== 'slack' ||
        (option.configurationStatus === 'ready' &&
          slackBots.data?.some((bot) => bot.id === option.slackBotCredentialId))
    )

  const name = draftName ?? credentialGroup?.name ?? ''
  const description = draftDescription ?? credentialGroup?.description ?? ''
  const normalizedDescription = description.trim() || null
  const detailsDirty = Boolean(
    credentialGroup &&
      (name.trim() !== credentialGroup.name ||
        normalizedDescription !== credentialGroup.description)
  )
  const guard = useSettingsUnsavedGuard({
    isDirty: detailsDirty || accessEditor.dirty,
    navigationBlocked: updateGroup.isPending || accessEditor.saving,
  })
  const credentialGroupMutationPending =
    updateGroup.isPending || accessEditor.saving || resend.isPending || deleteEnrollment.isPending

  const discardDetails = () => {
    setDraftName(null)
    setDraftDescription(null)
  }

  const handleTabChange = (value: string) => {
    const nextTab = value as CredentialGroupTab
    if (nextTab === activeTab) return
    guard.guardBack(() => {
      discardDetails()
      accessEditor.discard()
      void setActiveTab(nextTab)
    })
  }

  const handleSaveDetails = async () => {
    if (!credentialGroup || !name.trim()) return
    try {
      await updateGroup.mutateAsync({
        workspaceId,
        groupId: credentialGroup.id,
        body: { name: name.trim(), description: normalizedDescription },
      })
      discardDetails()
      toast.success('Details saved')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save details'))
    }
  }

  const actions: SettingsAction[] = credentialGroup
    ? [
        ...(activeTab === 'details'
          ? saveDiscardActions({
              dirty: detailsDirty,
              saving: updateGroup.isPending,
              onSave: () => void handleSaveDetails(),
              onDiscard: discardDetails,
              saveDisabled: !name.trim(),
              saveTooltip: name.trim() ? undefined : 'Name is required',
            })
          : activeTab === 'people'
            ? [
                {
                  text: 'Invite users',
                  icon: Plus,
                  variant: 'primary' as const,
                  onSelect: () => setShowInvite(true),
                  disabled: credentialGroup.status !== 'active' || !configurationReady,
                },
              ]
            : saveDiscardActions({
                dirty: accessEditor.dirty,
                saving: accessEditor.saving,
                onSave: () => void accessEditor.save(),
                onDiscard: accessEditor.discard,
                saveDisabled: !accessEditor.isReady,
                saveTooltip: !accessEditor.isReady ? 'Workflow access is unavailable' : undefined,
              })),
        {
          id: 'delete',
          text: deleteGroup.isPending ? 'Deleting...' : 'Delete',
          onSelect: () => setShowDelete(true),
          disabled: deleteGroup.isPending || credentialGroupMutationPending,
          tooltip: credentialGroupMutationPending
            ? 'Wait for the current Credential Group change to finish'
            : undefined,
        },
      ]
    : []

  const handleResend = async (enrollment: CredentialGroupEnrollment) => {
    try {
      await resend.mutateAsync({ workspaceId, groupId, enrollmentId: enrollment.id })
      toast.success(`Invitation resent to ${enrollment.email}`)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to resend invitation'))
    }
  }

  const handleDeleteEnrollment = async () => {
    if (!deletingEnrollment) return
    try {
      await deleteEnrollment.mutateAsync({
        workspaceId,
        groupId,
        enrollmentId: deletingEnrollment.id,
      })
      toast.success(`${deletingEnrollment.email} deleted`)
      setDeletingEnrollmentId(null)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to delete person'))
    }
  }

  const handleDelete = async () => {
    if (!credentialGroup) return
    try {
      await deleteGroup.mutateAsync({ workspaceId, groupId })
      setShowDelete(false)
      onBack()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not delete credential group'))
    }
  }

  return (
    <>
      <SettingsPanel
        back={{
          text: 'Credential groups',
          icon: ArrowLeft,
          onSelect: () => guard.guardBack(onBack),
        }}
        title={credentialGroup?.name ?? 'Credential group'}
        description={credentialGroup?.description ?? undefined}
        actions={actions}
        search={
          activeTab === 'details'
            ? {
                value: providerSearch,
                onChange: setProviderSearch,
                placeholder: 'Search accounts and MCP servers...',
                disabled: detail.isPending,
              }
            : undefined
        }
      >
        {detail.error ? (
          <SettingsEmptyState tone='error'>
            {getErrorMessage(detail.error, "Couldn't load credential group")}
          </SettingsEmptyState>
        ) : detail.isPending || !credentialGroup ? null : (
          <>
            <ChipModalTabs
              tabs={CREDENTIAL_GROUP_TABS}
              value={activeTab}
              onChange={handleTabChange}
              aria-label='Credential group sections'
            />

            {activeTab === 'details' && (
              <CredentialGroupDetails
                workspaceId={workspaceId}
                credentialGroup={credentialGroup}
                providerSearch={providerSearch}
                name={name}
                onNameChange={setDraftName}
                description={description}
                onDescriptionChange={setDraftDescription}
              />
            )}

            {activeTab === 'people' && (
              <SettingsSection
                label={`People (${enrollments.length}${detail.hasNextPage ? '+' : ''})`}
                action={
                  detail.hasNextPage ? (
                    <Chip
                      onClick={() => void detail.fetchNextPage()}
                      disabled={detail.isFetchingNextPage}
                    >
                      {detail.isFetchingNextPage ? 'Loading...' : 'Load more'}
                    </Chip>
                  ) : undefined
                }
              >
                {enrollments.length === 0 ? (
                  <SettingsEmptyState variant='inline'>No people invited yet</SettingsEmptyState>
                ) : (
                  <div className={RESOURCE_LIST_STACK}>
                    {enrollments.map((enrollment) => {
                      return (
                        <SettingsResourceRow
                          key={enrollment.id}
                          icon={<User className='text-[var(--text-icon)]' />}
                          iconFilled
                          title={enrollment.email}
                          description={
                            <EnrollmentConnections
                              connections={enrollment.connections}
                              mcpConnections={enrollment.mcpConnections}
                            />
                          }
                          trailing={
                            <RowActionsMenu
                              label={`${enrollment.email} actions`}
                              actions={[
                                {
                                  label: 'Resend',
                                  onSelect: () => void handleResend(enrollment),
                                  disabled: resend.isPending,
                                },
                                {
                                  label: 'Delete',
                                  destructive: true,
                                  onSelect: () => setDeletingEnrollmentId(enrollment.id),
                                },
                              ]}
                            />
                          }
                        />
                      )
                    })}
                  </div>
                )}
              </SettingsSection>
            )}

            {activeTab === 'access' && (
              <CredentialGroupAccess
                key={groupId}
                allowedWorkflowIds={accessEditor.allowedWorkflowIds}
                revision={accessEditor.revision}
                workflows={accessEditor.workflows}
                onAllowedWorkflowIdsChange={accessEditor.setAllowedWorkflowIds}
                error={accessEditor.error}
                isPending={accessEditor.isPending}
                loadError={accessEditor.loadError}
                saving={accessEditor.saving}
              />
            )}
          </>
        )}
      </SettingsPanel>
      {credentialGroup && (
        <CredentialGroupInviteModal
          open={showInvite}
          onOpenChange={setShowInvite}
          workspaceId={workspaceId}
          groupId={groupId}
        />
      )}
      <ChipConfirmModal
        open={Boolean(deletingEnrollment)}
        onOpenChange={(open) =>
          !open && !deleteEnrollment.isPending && setDeletingEnrollmentId(null)
        }
        srTitle='Delete person'
        title='Delete person'
        text={[
          `Delete ${deletingEnrollment?.email ?? 'this person'}?`,
          {
            text: ' Their private link will stop working and all accounts they connected to this Credential Group will be removed.',
            error: true,
          },
        ]}
        dismissLabel='Cancel'
        confirm={{
          label: deleteEnrollment.isPending ? 'Deleting...' : 'Delete',
          onClick: handleDeleteEnrollment,
          disabled: deleteEnrollment.isPending,
        }}
      />
      <ChipConfirmModal
        open={showDelete}
        onOpenChange={(open) => !open && !deleteGroup.isPending && setShowDelete(false)}
        srTitle='Delete credential group'
        title='Delete credential group'
        text={[
          `Delete ${credentialGroup?.name ?? 'this credential group'}?`,
          { text: ' This cannot be undone.', error: true },
        ]}
        dismissLabel='Cancel'
        confirm={{
          label: deleteGroup.isPending ? 'Deleting...' : 'Delete',
          onClick: handleDelete,
          disabled: deleteGroup.isPending,
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
