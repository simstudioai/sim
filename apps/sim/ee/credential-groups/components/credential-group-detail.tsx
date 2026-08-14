'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipModalTabs, ChipTag, toast } from '@sim/emcn'
import { ArrowLeft, KeySquare, Plus } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import type {
  CredentialGroupEnrollment,
  CredentialGroupEnrollmentConnection,
  CredentialGroupEnrollmentDetail,
} from '@/lib/api/contracts/credential-groups'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import { getCredentialGroupProviderService } from '@/lib/credential-groups/providers'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import {
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
import { CredentialGroupDetails } from '@/ee/credential-groups/components/credential-group-details'
import { CredentialGroupInviteModal } from '@/ee/credential-groups/components/credential-group-invite-modal'
import {
  useCredentialGroupDetail,
  useResendCredentialGroupEnrollment,
  useRevokeCredentialGroupEnrollment,
} from '@/hooks/queries/credential-groups'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'

interface CredentialGroupDetailProps {
  workspaceId: string
  groupId: string
  onBack: () => void
}

type CredentialGroupTab = 'details' | 'people'

const CREDENTIAL_GROUP_TABS = [
  { value: 'details', label: 'Details' },
  { value: 'people', label: 'People' },
] as const

function getEnrollmentStatus(
  enrollment: CredentialGroupEnrollmentDetail,
  activeProviders: CredentialGroupProvider[]
) {
  if (enrollment.status === 'revoked') return { label: 'Revoked', invalid: false }
  if (enrollment.status === 'delivery_failed') return { label: 'Delivery failed', invalid: true }
  const needsReauthorization = enrollment.connections.some(
    (connection) => connection.status === 'needs_reauth'
  )
  if (needsReauthorization) return { label: 'Reconnect needed', invalid: false }
  const connectedProviders = new Set(
    enrollment.connections
      .filter((connection) => connection.status === 'active')
      .map((connection) => connection.provider)
  )
  const allProvidersConnected =
    activeProviders.length > 0 &&
    activeProviders.every((provider) => connectedProviders.has(provider))
  if (enrollment.status === 'completed' && allProvidersConnected) {
    return { label: 'Connected', invalid: false }
  }
  if (enrollment.status === 'completed') return { label: 'In progress', invalid: false }
  if (enrollment.expired) return { label: 'Expired', invalid: true }
  if (enrollment.status === 'in_progress') return { label: 'In progress', invalid: false }
  return { label: 'Invited', invalid: false }
}

interface EnrollmentConnectionsProps {
  connections: CredentialGroupEnrollmentConnection[]
}

interface CredentialProviderIconProps {
  provider: CredentialGroupProvider
}

function CredentialProviderIcon({ provider }: CredentialProviderIconProps) {
  const ProviderIcon = getCredentialGroupProviderService(provider).icon
  return <ProviderIcon className='size-[14px]' aria-hidden />
}

function EnrollmentConnections({ connections }: EnrollmentConnectionsProps) {
  const connected = connections.filter((connection) => connection.status === 'active')
  const count = connected.reduce((total, connection) => total + connection.count, 0)
  const providers = [...new Set(connected.map((connection) => connection.provider))]

  return (
    <span className='flex items-center gap-1.5'>
      {providers.map((provider) => {
        return <CredentialProviderIcon key={provider} provider={provider} />
      })}
      <span>
        {count} connected {count === 1 ? 'account' : 'accounts'}
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
  const revoke = useRevokeCredentialGroupEnrollment()
  const [activeTab, setActiveTab] = useQueryState(credentialGroupTabParam.key, {
    ...credentialGroupTabParam.parser,
    ...credentialGroupTabUrlKeys,
  })
  const [showInvite, setShowInvite] = useState(false)
  const [revokingEnrollmentId, setRevokingEnrollmentId] = useState<string | null>(null)
  const credentialGroup = detail.data?.pages[0]?.credentialGroup
  const enrollments = detail.data?.pages.flatMap((page) => page.enrollments) ?? []
  const revokingEnrollment = revokingEnrollmentId
    ? (enrollments.find((enrollment) => enrollment.id === revokingEnrollmentId) ?? null)
    : null
  const activeProviders =
    credentialGroup?.options
      .filter((option) => option.status === 'active')
      .map((option) => option.provider) ?? []
  const configurationReady =
    Boolean(credentialGroup?.options.length) &&
    credentialGroup?.options.every(
      (option) =>
        option.provider !== 'slack' ||
        (option.configurationStatus === 'ready' &&
          slackBots.data?.some((bot) => bot.id === option.slackBotCredentialId))
    )

  const actions: SettingsAction[] = credentialGroup
    ? [
        {
          text: 'Invite users',
          icon: Plus,
          variant: 'primary',
          onSelect: () => setShowInvite(true),
          disabled: credentialGroup.status !== 'active' || !configurationReady,
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

  const handleRevoke = async () => {
    if (!revokingEnrollment) return
    try {
      await revoke.mutateAsync({
        workspaceId,
        groupId,
        enrollmentId: revokingEnrollment.id,
      })
      toast.success(`Invitation revoked for ${revokingEnrollment.email}`)
      setRevokingEnrollmentId(null)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to revoke invitation'))
    }
  }

  const handleBack = () => {
    void setActiveTab(null, { history: 'replace' })
    onBack()
  }

  return (
    <>
      <SettingsPanel
        back={{ text: 'Credential groups', icon: ArrowLeft, onSelect: handleBack }}
        title={credentialGroup?.name ?? 'Credential group'}
        description={credentialGroup?.description ?? undefined}
        actions={actions}
      >
        {detail.error ? (
          <SettingsEmptyState tone='error'>
            {getErrorMessage(detail.error, "Couldn't load credential group")}
          </SettingsEmptyState>
        ) : detail.isPending || !credentialGroup ? null : (
          <div className='flex flex-col gap-7'>
            <ChipModalTabs
              tabs={CREDENTIAL_GROUP_TABS}
              value={activeTab}
              onChange={(value) => void setActiveTab(value as CredentialGroupTab)}
              aria-label='Credential group sections'
            />

            {activeTab === 'details' && (
              <CredentialGroupDetails workspaceId={workspaceId} credentialGroup={credentialGroup} />
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
                      const status = getEnrollmentStatus(enrollment, activeProviders)
                      return (
                        <SettingsResourceRow
                          key={enrollment.id}
                          icon={<KeySquare />}
                          title={enrollment.email}
                          description={
                            <EnrollmentConnections connections={enrollment.connections} />
                          }
                          badge={
                            <ChipTag
                              variant={status.invalid ? 'invite' : 'gray'}
                              invalid={status.invalid}
                            >
                              {status.label}
                            </ChipTag>
                          }
                          trailing={
                            enrollment.status === 'revoked' ? undefined : (
                              <RowActionsMenu
                                label={`${enrollment.email} actions`}
                                actions={[
                                  {
                                    label: 'Resend',
                                    onSelect: () => void handleResend(enrollment),
                                    disabled: resend.isPending,
                                  },
                                  {
                                    label: 'Revoke',
                                    destructive: true,
                                    onSelect: () => setRevokingEnrollmentId(enrollment.id),
                                  },
                                ]}
                              />
                            )
                          }
                        />
                      )
                    })}
                  </div>
                )}
              </SettingsSection>
            )}
          </div>
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
        open={Boolean(revokingEnrollment)}
        onOpenChange={(open) => !open && !revoke.isPending && setRevokingEnrollmentId(null)}
        srTitle='Revoke invitation'
        title='Revoke invitation?'
        text={`Revoke the invitation for ${revokingEnrollment?.email ?? 'this user'}? Their private link will stop working immediately.`}
        dismissLabel='Cancel'
        confirm={{
          label: revoke.isPending ? 'Revoking...' : 'Revoke',
          onClick: handleRevoke,
          disabled: revoke.isPending,
        }}
      />
    </>
  )
}
