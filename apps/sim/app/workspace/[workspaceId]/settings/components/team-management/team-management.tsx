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
  useRemoveMember,
  useTransferOwnership,
} from '@/hooks/queries/organization'
import { useOpenBillingPortal, useSubscriptionData } from '@/hooks/queries/subscription'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const logger = createLogger('TeamManagement')

interface TeamManagementProps {
  organizationId: string
  billingHref?: string
}

export function TeamManagement({
  organizationId,
  billingHref = `/organization/${organizationId}/settings/billing`,
}: TeamManagementProps) {
  const { data: session, isPending: isSessionPending } = useSession()
  const { isInvitationsDisabled } = usePermissionConfig()

  const { data: userSubscriptionData } = useSubscriptionData()
  const subscriptionAccess = getSubscriptionAccessState(userSubscriptionData?.data)
  const hasTeamPlan = subscriptionAccess.hasUsableTeamAccess
  const hasEnterprisePlan = subscriptionAccess.hasUsableEnterpriseAccess

  const { data: organization, isLoading, error: orgError } = useOrganization(organizationId)
  const adminOrOwner = isAdminOrOwner(organization, session?.user?.email)

  const { data: organizationBillingData, isLoading: isOrgBillingLoading } = useOrganizationBilling(
    organizationId,
    { enabled: adminOrOwner }
  )

  const { data: roster, isLoading: isLoadingRoster } = useOrganizationRoster(organizationId)

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

  const externalEmails = useMemo(() => {
    const emails: string[] = []
    for (const member of roster?.members ?? []) {
      if (member.role === 'external') emails.push(member.email)
    }
    return emails
  }, [roster])

  /**
   * Pending invitations for emails that already belong to a member are
   * excluded: members can always be re-invited to additional workspaces (the
   * server dedupes per workspace), so only non-member pending emails are
   * blocked in the invite modal.
   */
  const pendingEmails = useMemo(() => {
    const memberEmailSet = new Set<string>()
    for (const member of roster?.members ?? []) {
      if (member.role !== 'external') memberEmailSet.add(member.email.toLowerCase())
    }
    const emails: string[] = []
    for (const invitation of roster?.pendingInvitations ?? []) {
      if (!memberEmailSet.has(invitation.email.toLowerCase())) emails.push(invitation.email)
    }
    return emails
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
  }, [orgName, orgSlug, createOrgMutation, session?.user])

  const handleRemoveMember = useCallback(
    async (member: Member) => {
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
    },
    [session?.user]
  )

  const confirmRemoveMember = useCallback(async () => {
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
        window.location.href = '/workspace'
      }
    } catch (error) {
      logger.error('Failed to remove member', error)
    }
  }, [
    removeMemberDialog.memberId,
    removeMemberDialog.isSelfRemoval,
    session?.user?.id,
    organizationId,
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
      try {
        const result = await transferOwnershipMutation.mutateAsync({
          orgId: organizationId,
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
    [organizationId, transferOwnershipMutation]
  )

  const handleOpenTransferBillingPortal = useCallback(() => {
    setTransferPortalError(null)
    const portalWindow = window.open('', '_blank')
    openBillingPortal.mutate(
      {
        context: 'organization',
        organizationId,
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
  }, [organizationId, openBillingPortal])

  const queryError = orgError
  const errorMessage = queryError instanceof Error ? queryError.message : null
  const displayOrganization = organization

  if (isLoading && !displayOrganization) {
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

  return (
    <>
      <section
        aria-label='Organization members'
        aria-busy={isSessionPending || isLoading || isLoadingRoster}
        className='flex flex-col gap-7'
      >
        <SettingsPanel
          actions={
            adminOrOwner
              ? [
                  {
                    text: 'Invite',
                    icon: Plus,
                    variant: 'primary',
                    onSelect: () => setInviteModalOpen(true),
                    disabled: isInvitationsDisabled,
                    tooltip: isInvitationsDisabled ? 'Invitations are disabled' : undefined,
                  },
                ]
              : []
          }
        >
          {adminOrOwner && (
            <TeamSeatsOverview
              billingHref={billingHref}
              subscriptionData={orgSubscription}
              isLoadingSubscription={isOrgBillingLoading}
              totalSeats={totalSeats}
              usedSeats={usedSeats}
              pendingSeats={pendingSeats}
            />
          )}

          <OrganizationMemberLists
            canManage={adminOrOwner}
            organizationId={displayOrganization.id}
            roster={roster ?? null}
            isLoadingRoster={isLoadingRoster}
            currentUserId={session?.user?.id ?? ''}
            onRemoveMember={handleRemoveMember}
            onTransferOwnership={handleOpenTransferDialog}
          />
        </SettingsPanel>
      </section>

      {adminOrOwner && (
        <OrganizationInviteModal
          open={inviteModalOpen}
          onOpenChange={setInviteModalOpen}
          organizationId={displayOrganization.id}
          workspaces={roster?.workspaces ?? []}
          externalEmails={externalEmails}
          pendingEmails={pendingEmails}
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
