'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipModalTabs, toast } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import type { CredentialGroupEnrollment } from '@/lib/api/contracts/credential-groups'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import { UnsavedChangesModal } from '@/app/workspace/[workspaceId]/components/credential-detail'
import { SearchSetupReturn } from '@/app/workspace/[workspaceId]/search/components/search-setup-return'
import {
  credentialGroupPeopleSearchParam,
  credentialGroupPeopleSearchUrlKeys,
  credentialGroupProviderSearchParam,
  credentialGroupProviderSearchUrlKeys,
  credentialGroupTabParam,
  credentialGroupTabUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import { MemberAvatar } from '@/app/workspace/[workspaceId]/settings/components/member-list'
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
import { EnrollmentConnections } from '@/ee/credential-groups/components/credential-group-enrollment-connections'
import { CredentialGroupInviteModal } from '@/ee/credential-groups/components/credential-group-invite-modal'
import {
  useCredentialGroupDetail,
  useDeleteCredentialGroupEnrollment,
  useResendCredentialGroupEnrollment,
  useUpdateCredentialGroup,
} from '@/hooks/queries/credential-groups'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

interface CredentialGroupDetailProps {
  workspaceId: string
  groupId: string
}

type CredentialGroupTab = 'details' | 'people' | 'access'

const CREDENTIAL_GROUP_TABS = [
  { value: 'details', label: 'Accounts' },
  { value: 'people', label: 'People' },
  { value: 'access', label: 'Workflow access' },
] as const

export function CredentialGroupDetail({ workspaceId, groupId }: CredentialGroupDetailProps) {
  const detail = useCredentialGroupDetail(workspaceId, groupId)
  const slackBots = useWorkspaceCredentials({
    workspaceId,
    type: 'service_account',
    providerId: SLACK_CUSTOM_BOT_PROVIDER_ID,
  })
  const resend = useResendCredentialGroupEnrollment()
  const deleteEnrollment = useDeleteCredentialGroupEnrollment()
  const updateGroup = useUpdateCredentialGroup()
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
  const [peopleSearch, setPeopleSearchParam] = useQueryState(credentialGroupPeopleSearchParam.key, {
    ...credentialGroupPeopleSearchParam.parser,
    ...credentialGroupPeopleSearchUrlKeys,
  })
  const setPeopleSearch = useDebouncedSearchSetter(setPeopleSearchParam)
  const [showInvite, setShowInvite] = useState(false)
  const [deletingEnrollmentId, setDeletingEnrollmentId] = useState<string | null>(null)
  const credentialGroup = detail.data?.pages[0]?.credentialGroup
  const enrollments = detail.data?.pages.flatMap((page) => page.enrollments) ?? []
  const peopleFilter = peopleSearch.trim().toLowerCase()
  /**
   * Only the pages already loaded: the enrollment list is cursor-paginated with no
   * server-side term, so a match on a later page appears only once it is fetched.
   */
  const visibleEnrollments = peopleFilter
    ? enrollments.filter((enrollment) => enrollment.email.toLowerCase().includes(peopleFilter))
    : enrollments
  /**
   * `+` means more people exist than are loaded, so it stays on the total. While
   * filtering, the match count is reported against that total rather than replacing
   * it — otherwise `People (2+)` reads as a two-person group with more to come.
   */
  const loadedTotal = `${enrollments.length}${detail.hasNextPage ? '+' : ''}`
  const peopleLabel = peopleFilter
    ? `People (${visibleEnrollments.length} of ${loadedTotal})`
    : `People (${loadedTotal})`
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

  const guard = useSettingsUnsavedGuard({
    isDirty: accessEditor.dirty,
    navigationBlocked: updateGroup.isPending || accessEditor.saving,
  })
  const credentialGroupMutationPending =
    updateGroup.isPending || accessEditor.saving || resend.isPending || deleteEnrollment.isPending

  const handleTabChange = (value: string) => {
    const nextTab = value as CredentialGroupTab
    if (nextTab === activeTab) return
    guard.guardBack(() => {
      accessEditor.discard()
      void setActiveTab(nextTab)
    })
  }

  const handleEnable = async () => {
    if (!credentialGroup) return
    try {
      await updateGroup.mutateAsync({
        workspaceId,
        groupId: credentialGroup.id,
        body: { status: 'active' },
      })
      toast.success('Connected accounts enabled')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not enable connected accounts'))
    }
  }

  const actions: SettingsAction[] = credentialGroup
    ? [
        ...(credentialGroup.status === 'disabled'
          ? [
              {
                text: updateGroup.isPending ? 'Enabling...' : 'Enable accounts',
                variant: 'primary' as const,
                onSelect: () => void handleEnable(),
                disabled: credentialGroupMutationPending,
              },
            ]
          : []),
        ...(activeTab === 'people'
          ? [
              {
                text: 'Request connections',
                icon: Plus,
                variant: 'primary' as const,
                onSelect: () => setShowInvite(true),
                disabled: credentialGroup.status !== 'active' || !configurationReady,
              },
            ]
          : activeTab === 'access'
            ? saveDiscardActions({
                dirty: accessEditor.dirty,
                saving: accessEditor.saving,
                onSave: () => void accessEditor.save(),
                onDiscard: accessEditor.discard,
                saveDisabled: !accessEditor.isReady,
                saveTooltip: !accessEditor.isReady ? 'Workflow access is unavailable' : undefined,
              })
            : []),
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

  return (
    <>
      <SettingsPanel
        actions={actions}
        search={
          activeTab === 'details'
            ? {
                value: providerSearch,
                onChange: setProviderSearch,
                placeholder: 'Search accounts and MCP servers...',
                disabled: detail.isPending,
              }
            : activeTab === 'people'
              ? {
                  value: peopleSearch,
                  onChange: setPeopleSearch,
                  placeholder: 'Search people...',
                  disabled: detail.isPending,
                }
              : undefined
        }
      >
        <SearchSetupReturn workspaceId={workspaceId} onNavigate={guard.guardBack} />
        {detail.error ? (
          <SettingsEmptyState tone='error'>
            {getErrorMessage(detail.error, "Couldn't load connected accounts")}
          </SettingsEmptyState>
        ) : detail.isPending || !credentialGroup ? null : (
          <>
            <ChipModalTabs
              tabs={CREDENTIAL_GROUP_TABS}
              value={activeTab}
              onChange={handleTabChange}
              aria-label='Connected accounts sections'
            />

            {activeTab === 'details' && (
              <>
                <CredentialGroupDetails
                  workspaceId={workspaceId}
                  credentialGroup={credentialGroup}
                  providerSearch={providerSearch}
                />
              </>
            )}

            {activeTab === 'people' && (
              <SettingsSection
                label={peopleLabel}
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
                {visibleEnrollments.length === 0 ? (
                  <SettingsEmptyState variant='inline'>
                    {peopleFilter ? 'No people match your search' : 'No people invited yet'}
                  </SettingsEmptyState>
                ) : (
                  <div className={RESOURCE_LIST_STACK}>
                    {visibleEnrollments.map((enrollment) => {
                      return (
                        <SettingsResourceRow
                          key={enrollment.id}
                          icon={<MemberAvatar name={enrollment.email} image={null} />}
                          iconVariant='custom'
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
            text: ' Their invitation link will stop working and the accounts they connected here will be removed.',
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
      <UnsavedChangesModal
        open={guard.showUnsavedModal}
        onOpenChange={guard.setShowUnsavedModal}
        onDiscard={guard.confirmDiscard}
      />
    </>
  )
}
