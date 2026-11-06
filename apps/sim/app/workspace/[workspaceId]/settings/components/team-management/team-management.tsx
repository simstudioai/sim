'use client'

import { useState } from 'react'
import { Plus, toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/predicates'
import { getErrorMessage } from '@sim/utils/errors'
import { useSettingsUnsavedGuard } from '@/components/settings/use-settings-unsaved-guard'
import { useSession } from '@/lib/auth/client'
import { getSubscriptionAccessState } from '@/lib/billing/client/utils'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { generateSlug, type Member } from '@/lib/workspaces/organization'
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
  useOrganizationRoster,
  useOrganizationSummary,
  useRemoveMember,
  useTransferOwnership,
} from '@/hooks/queries/organization'
import { useOrganizationPlanSeats } from '@/hooks/queries/organization-plan-seats'
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
  const { billingEnabled } = useDeploymentShape()
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
  const shouldLoadRecoverySubscription = billingEnabled && !isLoading && !orgError && !organization
  const { data: userSubscriptionData, isPending: isRecoverySubscriptionPending } =
    useSubscriptionData({
      enabled: shouldLoadRecoverySubscription,
    })
  const subscriptionAccess = getSubscriptionAccessState(userSubscriptionData?.data)
  const hasTeamPlan = subscriptionAccess.hasUsableTeamAccess
  const hasEnterprisePlan = subscriptionAccess.hasUsableEnterpriseAccess

  const {
    data: roster,
    isLoading: isLoadingRoster,
    error: rosterError,
    isFetchedAfterMount: isRosterFetchedAfterMount,
    isFetching: isRosterFetching,
    refetch: refetchRoster,
  } = useOrganizationRoster(organizationId)

  // Only a row naming the caller (the roster) or the server's own role read is authoritative:
  // Better Auth's full-organization read caps its member list and can omit or lag the caller.
  const rosterRole = roster?.members.find((member) => member.userId === session?.user?.id)?.role
  const organizationSummary = useOrganizationSummary(organizationId, {
    enabled: rosterError !== null,
    refetchOnMount: 'always',
  })
  // Fetched on this mount, so the identity-scoped role belongs to the current session.
  const summaryRole = organizationSummary.isFetchedAfterMount
    ? organizationSummary.data?.userRole
    : undefined
  const confirmedRole = rosterRole ?? summaryRole
  const adminOrOwner = isOrgAdminRole(
    confirmedRole ??
      organization?.members.find((member) => member.user.email === session?.user?.email)?.role ??
      'member'
  )
  const canLeave = confirmedRole !== undefined && confirmedRole !== 'owner'

  const {
    data: organizationBillingData,
    isLoading: isOrgBillingLoading,
    error: organizationBillingError,
    isFetchedAfterMount: isOrganizationBillingFetchedAfterMount,
    isFetching: isOrganizationBillingFetching,
    refetch: refetchOrganizationBilling,
  } = useOrganizationPlanSeats(organizationId, { enabled: billingEnabled && adminOrOwner })

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
  const defaultOrgName =
    (hasTeamPlan || hasEnterprisePlan) && session?.user?.name ? `${session.user.name}'s Team` : ''
  const defaultOrganization = { name: defaultOrgName, slug: generateSlug(defaultOrgName) }
  const [organizationDraft, setOrganizationDraft] = useState<{
    baseline: typeof defaultOrganization
    values: typeof defaultOrganization
  } | null>(null)
  const orgName = organizationDraft?.values.name ?? defaultOrganization.name
  const orgSlug = organizationDraft?.values.slug ?? defaultOrganization.slug
  const updateOrganizationDraft = (change: Partial<typeof defaultOrganization>) => {
    if (createOrgMutation.isPending) return
    setOrganizationDraft((current) => {
      const baseline = current?.baseline ?? defaultOrganization
      const values = { ...(current?.values ?? baseline), ...change }
      return values.name === baseline.name && values.slug === baseline.slug
        ? null
        : { baseline, values }
    })
  }
  const setOrgSlug = (slug: string) => updateOrganizationDraft({ slug })
  useSettingsUnsavedGuard({
    isDirty: !organization && (hasTeamPlan || hasEnterprisePlan) && organizationDraft !== null,
    navigationBlocked: createOrgMutation.isPending,
    onDiscard: () => setOrganizationDraft(null),
  })

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
   * Organization plan metadata comes from the primary database; Better Auth's
   * `client.subscription.list` does not reliably surface org-scoped subscriptions.
   */
  const orgBilling = billingEnabled ? (organizationBillingData?.data ?? null) : null
  const orgSubscription = orgBilling?.subscriptionPlan
    ? {
        id: orgBilling.organizationId,
        plan: orgBilling.subscriptionPlan,
        status: orgBilling.subscriptionStatus ?? 'active',
        referenceId: orgBilling.organizationId,
      }
    : null

  const handleOrgNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    updateOrganizationDraft({ name: newName, slug: generateSlug(newName) })
  }

  const handleCreateOrganization = async () => {
    if (!session?.user || !orgName.trim() || createOrgMutation.isPending) return

    try {
      await createOrgMutation.mutateAsync({
        name: orgName.trim(),
        slug: orgSlug.trim(),
      })

      setCreateOrgDialogOpen(false)
      setOrganizationDraft(null)
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

  const handleLeave = () => {
    if (!session?.user) return
    setRemoveMemberDialog({
      open: true,
      memberId: session.user.id,
      memberName: 'yourself',
      isSelfRemoval: true,
      isExternalRemoval: false,
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
      } else if (result.warning) {
        toast.warning(`Ownership transferred. ${result.warning}`)
      }
    } catch (error) {
      logger.error('Failed to transfer ownership', error)
    }
  }

  const handleOpenTransferBillingPortal = () => {
    setTransferPortalError(null)
    openBillingPortal.open(
      {
        context: 'organization',
        organizationId,
        returnUrl: `${getBaseUrl()}${APP_ENTRY_PATH}`,
      },
      (error) => {
        logger.error('Failed to open billing portal from transfer dialog', { error })
        setTransferPortalError(
          getErrorMessage(error, 'Failed to open Stripe billing portal. Please try again.')
        )
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
        actions={[
          ...(canLeave
            ? [
                {
                  id: 'leave-organization',
                  text: 'Leave organization',
                  variant: 'destructive' as const,
                  onSelect: handleLeave,
                },
              ]
            : []),
          ...(adminOrOwner
            ? [
                {
                  id: 'invite',
                  text: 'Invite',
                  icon: Plus,
                  variant: 'primary' as const,
                  onSelect: () => setInviteModalOpen(true),
                  disabled: invitationsDisabled,
                  tooltip: invitationsDisabled ? 'Invitations are disabled' : undefined,
                },
              ]
            : []),
        ]}
      >
        {billingEnabled &&
          adminOrOwner &&
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
