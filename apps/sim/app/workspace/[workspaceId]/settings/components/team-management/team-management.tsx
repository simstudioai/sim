'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionAccessState } from '@/lib/billing/client/utils'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { generateSlug, isAdminOrOwner, type Member } from '@/lib/workspaces/organization'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  NoOrganizationView,
  OrganizationInviteModal,
  OrganizationMemberLists,
  RemoveMemberDialog,
  TeamSeatsOverview,
  TransferOwnershipDialog,
} from '@/app/workspace/[workspaceId]/settings/components/team-management/components'
import {
  useCreateOrganization,
  useOrganization,
  useOrganizationBilling,
  useOrganizationRoster,
  useOrganizations,
  useRemoveMember,
  useTransferOwnership,
} from '@/hooks/queries/organization'
import { useOpenBillingPortal, useSubscriptionData } from '@/hooks/queries/subscription'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const logger = createLogger('TeamManagement')

export function TeamManagement() {
  const { data: session } = useSession()
  const { isInvitationsDisabled } = usePermissionConfig()

  const { data: organizationsData } = useOrganizations()
  const activeOrganization = organizationsData?.activeOrganization

  const { data: userSubscriptionData } = useSubscriptionData()
  const subscriptionAccess = getSubscriptionAccessState(userSubscriptionData?.data)
  const hasTeamPlan = subscriptionAccess.hasUsableTeamAccess
  const hasEnterprisePlan = subscriptionAccess.hasUsableEnterpriseAccess

  const {
    data: organization,
    isLoading,
    error: orgError,
  } = useOrganization(activeOrganization?.id || '')

  const { data: organizationBillingData, isLoading: isOrgBillingLoading } = useOrganizationBilling(
    activeOrganization?.id || ''
  )

  const { data: roster, isLoading: isLoadingRoster } = useOrganizationRoster(activeOrganization?.id)

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

  const adminOrOwner = isAdminOrOwner(organization, session?.user?.email)
  const totalSeats = organizationBillingData?.data?.totalSeats ?? 0
  const usedSeats = organizationBillingData?.data?.members?.length ?? 0
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

  const externalEmails = useMemo(
    () =>
      (roster?.members ?? [])
        .filter((member) => member.role === 'external')
        .map((member) => member.email),
    [roster]
  )

  /**
   * Pending invitations for emails that already belong to a member are
   * excluded: members can always be re-invited to additional workspaces (the
   * server dedupes per workspace), so only non-member pending emails are
   * blocked in the invite modal.
   */
  const pendingEmails = useMemo(() => {
    const memberEmailSet = new Set(
      (roster?.members ?? [])
        .filter((member) => member.role !== 'external')
        .map((member) => member.email.toLowerCase())
    )
    return (roster?.pendingInvitations ?? [])
      .map((invitation) => invitation.email)
      .filter((email) => !memberEmailSet.has(email.toLowerCase()))
  }, [roster])

  useEffect(() => {
    if ((hasTeamPlan || hasEnterprisePlan) && session?.user?.name && !orgName) {
      const defaultName = `${session.user.name}'s Team`
      setOrgName(defaultName)
      setOrgSlug(generateSlug(defaultName))
    }
  }, [hasTeamPlan, hasEnterprisePlan, session?.user?.name, orgName])

  const handleOrgNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setOrgName(newName)
    setOrgSlug(generateSlug(newName))
  }, [])

  const handleCreateOrganization = useCallback(async () => {
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
  }, [orgName, orgSlug, createOrgMutation])

  const handleRemoveMember = useCallback(
    async (member: Member) => {
      if (!session?.user || !activeOrganization?.id) return

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
    },
    [session?.user, activeOrganization?.id]
  )

  const confirmRemoveMember = useCallback(async () => {
    const { memberId, isSelfRemoval } = removeMemberDialog
    if (!session?.user || !activeOrganization?.id || !memberId) return

    try {
      await removeMemberMutation.mutateAsync({
        memberId,
        orgId: activeOrganization?.id,
      })

      setRemoveMemberDialog({
        open: false,
        memberId: '',
        memberName: '',
        isExternalRemoval: false,
      })

      if (isSelfRemoval) {
        window.location.href = '/workspace'
      }
    } catch (error) {
      logger.error('Failed to remove member', error)
    }
  }, [
    removeMemberDialog.memberId,
    removeMemberDialog.isSelfRemoval,
    session?.user?.id,
    activeOrganization?.id,
    removeMemberMutation,
  ])

  const handleTransferDialogOpenChange = useCallback(
    (next: boolean) => {
      setTransferDialogOpen(next)
      if (!next) {
        transferOwnershipMutation.reset()
        setTransferPortalError(null)
      }
    },
    [transferOwnershipMutation]
  )

  const handleOpenTransferDialog = useCallback(() => {
    transferOwnershipMutation.reset()
    setTransferPortalError(null)
    setTransferDialogOpen(true)
  }, [transferOwnershipMutation])

  const handleConfirmTransfer = useCallback(
    async (newOwnerUserId: string) => {
      if (!activeOrganization?.id) return

      try {
        const result = await transferOwnershipMutation.mutateAsync({
          orgId: activeOrganization.id,
          newOwnerUserId,
          alsoLeave: true,
        })

        setTransferDialogOpen(false)

        if (result.left) {
          window.location.href = '/workspace'
        }
      } catch (error) {
        logger.error('Failed to transfer ownership', error)
      }
    },
    [activeOrganization?.id, transferOwnershipMutation]
  )

  const handleOpenTransferBillingPortal = useCallback(() => {
    if (!activeOrganization?.id) return
    setTransferPortalError(null)
    const portalWindow = window.open('', '_blank')
    openBillingPortal.mutate(
      {
        context: 'organization',
        organizationId: activeOrganization.id,
        returnUrl: `${getBaseUrl()}/workspace`,
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
            error instanceof Error
              ? error.message
              : 'Failed to open Stripe billing portal. Please try again.'
          )
        },
      }
    )
  }, [activeOrganization?.id, openBillingPortal])

  const queryError = orgError
  const errorMessage = queryError instanceof Error ? queryError.message : null
  const displayOrganization = organization || activeOrganization

  if (isLoading && !displayOrganization && !(hasTeamPlan || hasEnterprisePlan)) {
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
        error={errorMessage}
        createOrgDialogOpen={createOrgDialogOpen}
        setCreateOrgDialogOpen={setCreateOrgDialogOpen}
      />
    )
  }

  if (!adminOrOwner) {
    return null
  }

  return (
    <>
      <SettingsPanel
        actions={[
          {
            text: 'Invite',
            icon: Plus,
            variant: 'primary',
            onSelect: () => setInviteModalOpen(true),
            disabled: isInvitationsDisabled,
            tooltip: isInvitationsDisabled ? 'Invitations are disabled' : undefined,
          },
        ]}
      >
        <TeamSeatsOverview
          subscriptionData={orgSubscription}
          isLoadingSubscription={isOrgBillingLoading}
          totalSeats={totalSeats}
          usedSeats={usedSeats}
          pendingSeats={pendingSeats}
        />

        <OrganizationMemberLists
          organizationId={displayOrganization.id}
          roster={roster ?? null}
          isLoadingRoster={isLoadingRoster}
          currentUserId={session?.user?.id ?? ''}
          onRemoveMember={handleRemoveMember}
          onTransferOwnership={handleOpenTransferDialog}
        />
      </SettingsPanel>

      <OrganizationInviteModal
        open={inviteModalOpen}
        onOpenChange={setInviteModalOpen}
        organizationId={displayOrganization.id}
        workspaces={roster?.workspaces ?? []}
        externalEmails={externalEmails}
        pendingEmails={pendingEmails}
      />

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
