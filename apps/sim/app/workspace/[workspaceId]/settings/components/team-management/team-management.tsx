'use client'

import { useEffect, useState } from 'react'
import { Plus } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionAccessState } from '@/lib/billing/client/utils'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { generateSlug, isAdminOrOwner, type Member } from '@/lib/workspaces/organization'
import { InviteModal } from '@/app/workspace/[workspaceId]/components/invite-modal'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  NoOrganizationView,
  OrganizationMemberLists,
  RemoveMemberDialog,
  TeamSeatsOverview,
  TransferOwnershipDialog,
} from '@/app/workspace/[workspaceId]/settings/components/team-management/components'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import {
  useCreateOrganization,
  useMemberRemovalImpact,
  useOrganization,
  useOrganizationBilling,
  useOrganizationRoster,
  useRemoveMember,
  useTransferOwnership,
} from '@/hooks/queries/organization'
import { useOpenBillingPortal, useSubscriptionData } from '@/hooks/queries/subscription'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const logger = createLogger('TeamManagement')

interface TeamManagementProps {
  organizationId: string
  canInviteMembers?: boolean
  /**
   * The caller owns navigation so the same panel works in organization and
   * legacy workspace settings.
   */
  billingHref: string
}

export function TeamManagement({
  organizationId,
  billingHref,
  canInviteMembers,
}: TeamManagementProps) {
  const { data: session } = useSession()
  const { isInvitationsDisabled } = usePermissionConfig()
  const invitationsDisabled =
    canInviteMembers === undefined ? isInvitationsDisabled : !canInviteMembers
  const [memberQuery, setMemberQuery] = useSettingsSearch()

  const {
    data: organization,
    isLoading,
    error: orgError,
    isFetchedAfterMount: isOrganizationFetchedAfterMount,
    isFetching: isOrganizationFetching,
    refetch: refetchOrganization,
  } = useOrganization(organizationId)
  /**
   * Personal billing only supports the legacy missing-organization recovery view. A valid
   * organization page derives its plan from organization billing, so avoid that unrelated read
   * on the normal first paint.
   */
  const shouldLoadRecoverySubscription = !isLoading && !orgError && !organization
  const { data: userSubscriptionData, isPending: isRecoverySubscriptionPending } =
    useSubscriptionData({
      enabled: shouldLoadRecoverySubscription,
    })
  const subscriptionAccess = getSubscriptionAccessState(userSubscriptionData?.data)
  const hasTeamPlan = subscriptionAccess.hasUsableTeamAccess
  const hasEnterprisePlan = subscriptionAccess.hasUsableEnterpriseAccess

  const adminOrOwner = isAdminOrOwner(organization, session?.user?.email)

  const {
    data: organizationBillingData,
    isLoading: isOrgBillingLoading,
    error: organizationBillingError,
    isFetchedAfterMount: isOrganizationBillingFetchedAfterMount,
    isFetching: isOrganizationBillingFetching,
    refetch: refetchOrganizationBilling,
  } = useOrganizationBilling(organizationId, { enabled: adminOrOwner })

  const {
    data: roster,
    isLoading: isLoadingRoster,
    error: rosterError,
    isFetchedAfterMount: isRosterFetchedAfterMount,
    isFetching: isRosterFetching,
    refetch: refetchRoster,
  } = useOrganizationRoster(organizationId)

  const removeMemberMutation = useRemoveMember()
  const transferOwnershipMutation = useTransferOwnership()
  const openBillingPortal = useOpenBillingPortal()
  const createOrgMutation = useCreateOrganization()

  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [createOrgDialogOpen, setCreateOrgDialogOpen] = useState(false)
  const [removeMemberDialog, setRemoveMemberDialog] = useState<{
    open: boolean
    memberId: string
    memberName: string
    isSelfRemoval?: boolean
    isExternalRemoval?: boolean
  }>({ open: false, memberId: '', memberName: '' })
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [transferPortalError, setTransferPortalError] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')

  /**
   * `isFetching` (not `isLoading`) gates the confirm button: a background
   * refetch of cached data must also hold removal so the admin never
   * confirms against a stale credential-impact list.
   */
  const {
    data: removalImpactCredentials,
    isFetching: isRemovalImpactFetching,
    isError: isRemovalImpactError,
  } = useMemberRemovalImpact(organizationId, removeMemberDialog.memberId, {
    enabled: removeMemberDialog.open,
  })

  const disclosedBreakingCredentials = [
    ...new Set(removalImpactCredentials?.map((credential) => credential.displayName) ?? []),
  ]

  const totalSeats = organizationBillingData?.data?.totalSeats ?? 0
  const usedSeats = organizationBillingData?.data?.membersTotal ?? 0
  const reservedSeats = organizationBillingData?.data?.usedSeats ?? 0
  const pendingSeats = Math.max(0, reservedSeats - usedSeats)

  /**
   * The org's active subscription, derived from DB-backed organization billing
   * (`getOrganizationBillingData` only returns data when an entitled org
   * subscription exists). We intentionally do not read this from better-auth's
   * `client.subscription.list`, which does not reliably surface org-scoped
   * subscriptions.
   */
  const orgBilling = organizationBillingData?.data ?? null
  const orgSubscription = orgBilling
    ? {
        id: orgBilling.organizationId,
        plan: orgBilling.subscriptionPlan,
        status: orgBilling.subscriptionStatus ?? 'active',
        referenceId: orgBilling.organizationId,
      }
    : null

  useEffect(() => {
    if ((hasTeamPlan || hasEnterprisePlan) && session?.user?.name && !orgName) {
      const defaultName = `${session.user.name}'s Team`
      setOrgName(defaultName)
      setOrgSlug(generateSlug(defaultName))
    }
  }, [hasTeamPlan, hasEnterprisePlan, session?.user?.name, orgName])

  const handleOrgNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setOrgName(newName)
    setOrgSlug(generateSlug(newName))
  }

  const handleCreateOrganization = async () => {
    if (!session?.user || !orgName.trim()) return

    try {
      await createOrgMutation.mutateAsync({
        name: orgName.trim(),
        slug: orgSlug.trim(),
      })

      setCreateOrgDialogOpen(false)
      setOrgName('')
      setOrgSlug('')
    } catch (error) {
      logger.error('Failed to create organization', error)
    }
  }

  const handleRemoveMember = async (member: Member) => {
    if (!session?.user) return

    if (!member.user?.id) {
      logger.error('Member object missing user ID', { member })
      return
    }

    const isLeavingSelf = member.user?.email === session.user.email
    const displayName = isLeavingSelf
      ? 'yourself'
      : member.user?.name || member.user?.email || 'this member'

    setRemoveMemberDialog({
      open: true,
      memberId: member.user.id,
      memberName: displayName,
      isSelfRemoval: isLeavingSelf,
      isExternalRemoval: member.role === 'external',
    })
  }

  const confirmRemoveMember = async () => {
    const { memberId, isSelfRemoval } = removeMemberDialog
    if (!session?.user || !memberId) return

    try {
      await removeMemberMutation.mutateAsync({
        memberId,
        orgId: organizationId,
      })

      setRemoveMemberDialog({
        open: false,
        memberId: '',
        memberName: '',
        isExternalRemoval: false,
      })

      if (isSelfRemoval) {
        window.location.href = APP_ENTRY_PATH
      }
    } catch (error) {
      logger.error('Failed to remove member', error)
    }
  }

  const handleTransferDialogOpenChange = (next: boolean) => {
    setTransferDialogOpen(next)
    if (!next) {
      transferOwnershipMutation.reset()
      setTransferPortalError(null)
    }
  }

  const handleOpenTransferDialog = () => {
    transferOwnershipMutation.reset()
    setTransferPortalError(null)
    setTransferDialogOpen(true)
  }

  const handleConfirmTransfer = async (newOwnerUserId: string) => {
    try {
      const result = await transferOwnershipMutation.mutateAsync({
        orgId: organizationId,
        newOwnerUserId,
        alsoLeave: true,
      })

      setTransferDialogOpen(false)

      if (result.left) {
        window.location.href = APP_ENTRY_PATH
      }
    } catch (error) {
      logger.error('Failed to transfer ownership', error)
    }
  }

  const handleOpenTransferBillingPortal = () => {
    setTransferPortalError(null)
    const portalWindow = window.open('', '_blank')
    openBillingPortal.mutate(
      {
        context: 'organization',
        organizationId,
        returnUrl: `${getBaseUrl()}${APP_ENTRY_PATH}`,
      },
      {
        onSuccess: (data) => {
          if (portalWindow) {
            portalWindow.location.href = data.url
          } else {
            window.location.href = data.url
          }
        },
        onError: (error) => {
          portalWindow?.close()
          logger.error('Failed to open billing portal from transfer dialog', { error })
          setTransferPortalError(
            getErrorMessage(error, 'Failed to open Stripe billing portal. Please try again.')
          )
        },
      }
    )
  }

  const displayOrganization = organization

  if (isLoading && !isOrganizationFetchedAfterMount && !displayOrganization) {
    return null
  }

  if (
    (orgError || (isOrganizationFetching && isOrganizationFetchedAfterMount)) &&
    !displayOrganization
  ) {
    return (
      <SettingsPanel>
        <SettingsQueryErrorState
          error={orgError}
          fallback='Failed to load organization'
          isRetrying={isOrganizationFetching}
          onRetry={() => void refetchOrganization()}
        />
      </SettingsPanel>
    )
  }

  if (!displayOrganization && shouldLoadRecoverySubscription && isRecoverySubscriptionPending) {
    return null
  }

  if (!displayOrganization) {
    return (
      <NoOrganizationView
        hasTeamPlan={hasTeamPlan}
        hasEnterprisePlan={hasEnterprisePlan}
        orgName={orgName}
        orgSlug={orgSlug}
        setOrgSlug={setOrgSlug}
        onOrgNameChange={handleOrgNameChange}
        onCreateOrganization={handleCreateOrganization}
        isCreatingOrg={createOrgMutation.isPending}
        error={
          createOrgMutation.error
            ? getErrorMessage(createOrgMutation.error, 'Failed to create organization')
            : null
        }
        createOrgDialogOpen={createOrgDialogOpen}
        setCreateOrgDialogOpen={setCreateOrgDialogOpen}
      />
    )
  }

  return (
    <>
      <SettingsPanel
        search={{
          value: memberQuery,
          onChange: setMemberQuery,
          placeholder: 'Search members...',
        }}
        actions={
          adminOrOwner
            ? [
                {
                  text: 'Invite',
                  icon: Plus,
                  variant: 'primary',
                  onSelect: () => setInviteModalOpen(true),
                  disabled: invitationsDisabled,
                  tooltip: invitationsDisabled ? 'Invitations are disabled' : undefined,
                },
              ]
            : []
        }
      >
        {adminOrOwner &&
          ((organizationBillingError ||
            (isOrganizationBillingFetching && isOrganizationBillingFetchedAfterMount)) &&
          organizationBillingData === undefined ? (
            <SettingsQueryErrorState
              error={organizationBillingError}
              fallback='Failed to load seat information'
              isRetrying={isOrganizationBillingFetching}
              onRetry={() => void refetchOrganizationBilling()}
              variant='inline'
            />
          ) : (
            <TeamSeatsOverview
              billingHref={billingHref}
              subscriptionData={orgSubscription}
              isLoadingSubscription={isOrgBillingLoading}
              totalSeats={totalSeats}
              usedSeats={usedSeats}
              pendingSeats={pendingSeats}
            />
          ))}

        {isLoadingRoster && !isRosterFetchedAfterMount ? (
          <SettingsEmptyState variant='inline'>Loading members…</SettingsEmptyState>
        ) : (rosterError || (isRosterFetching && isRosterFetchedAfterMount)) &&
          roster === undefined ? (
          <SettingsQueryErrorState
            error={rosterError}
            fallback='Failed to load organization members'
            isRetrying={isRosterFetching}
            onRetry={() => void refetchRoster()}
            variant='inline'
          />
        ) : (
          <OrganizationMemberLists
            canManage={adminOrOwner}
            organizationId={displayOrganization.id}
            roster={roster ?? null}
            isLoadingRoster={false}
            currentUserId={session?.user?.id ?? ''}
            query={memberQuery}
            onRemoveMember={handleRemoveMember}
            onTransferOwnership={handleOpenTransferDialog}
          />
        )}
      </SettingsPanel>

      {adminOrOwner && (
        <InviteModal
          open={inviteModalOpen}
          onOpenChange={setInviteModalOpen}
          organizationId={displayOrganization.id}
          isOrganizationAdmin={adminOrOwner}
          canInvite={adminOrOwner && !invitationsDisabled}
        />
      )}

      <TransferOwnershipDialog
        open={transferDialogOpen}
        onOpenChange={handleTransferDialogOpenChange}
        members={roster?.members ?? []}
        isLoadingMembers={isLoadingRoster}
        currentUserId={session?.user?.id ?? ''}
        isSubmitting={transferOwnershipMutation.isPending}
        error={transferOwnershipMutation.error}
        portalError={transferPortalError}
        hasPaidSubscription={Boolean(orgSubscription)}
        isOpeningBillingPortal={openBillingPortal.isPending}
        onConfirm={handleConfirmTransfer}
        onOpenBillingPortal={handleOpenTransferBillingPortal}
      />

      <RemoveMemberDialog
        open={removeMemberDialog.open}
        memberName={removeMemberDialog.memberName}
        isSelfRemoval={removeMemberDialog.isSelfRemoval}
        isExternalRemoval={removeMemberDialog.isExternalRemoval}
        breakingCredentials={disclosedBreakingCredentials}
        credentialImpactPending={isRemovalImpactFetching}
        credentialImpactFailed={isRemovalImpactError}
        isSubmitting={removeMemberMutation.isPending}
        error={removeMemberMutation.error}
        onOpenChange={(open: boolean) => {
          if (!open) setRemoveMemberDialog({ ...removeMemberDialog, open: false })
        }}
        onConfirmRemove={confirmRemoveMember}
        onCancel={() =>
          setRemoveMemberDialog({
            open: false,
            memberId: '',
            memberName: '',
            isSelfRemoval: false,
            isExternalRemoval: false,
          })
        }
      />
    </>
  )
}
