'use client'

import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Skeleton, type TagItem } from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionAccessState } from '@/lib/billing/client/utils'
import { getPlanTierCredits, getPlanTierDollars } from '@/lib/billing/plan-helpers'
import { checkEnterprisePlan } from '@/lib/billing/subscriptions/utils'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  generateSlug,
  getUsedSeats,
  isAdminOrOwner,
  type Member,
} from '@/lib/workspaces/organization'
import {
  MemberInvitationCard,
  NoOrganizationView,
  OrganizationRoster,
  RemoveMemberDialog,
  TeamSeats,
  TeamSeatsOverview,
  TransferOwnershipDialog,
} from '@/app/workspace/[workspaceId]/settings/components/team-management/components'
import {
  useCreateOrganization,
  useInviteMember,
  useOrganization,
  useOrganizationBilling,
  useOrganizationRoster,
  useOrganizationSubscription,
  useOrganizations,
  useRemoveMember,
  useTransferOwnership,
  useUpdateSeats,
} from '@/hooks/queries/organization'
import { useOpenBillingPortal, useSubscriptionData } from '@/hooks/queries/subscription'
import { useAdminWorkspaces } from '@/hooks/queries/workspace'
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

  const {
    data: subscriptionData,
    isLoading: isLoadingSubscription,
    error: subscriptionError,
  } = useOrganizationSubscription(activeOrganization?.id || '')

  const { data: organizationBillingData } = useOrganizationBilling(activeOrganization?.id || '')

  const { data: roster, isLoading: isLoadingRoster } = useOrganizationRoster(activeOrganization?.id)

  const inviteMutation = useInviteMember()
  const removeMemberMutation = useRemoveMember()
  const transferOwnershipMutation = useTransferOwnership()
  const openBillingPortal = useOpenBillingPortal()
  const updateSeatsMutation = useUpdateSeats()
  const createOrgMutation = useCreateOrganization()

  const costPerSeat = getPlanTierDollars(subscriptionData?.plan)
  const creditsPerSeat = getPlanTierCredits(subscriptionData?.plan)

  const [inviteSuccess, setInviteSuccess] = useState(false)

  const [inviteEmails, setInviteEmails] = useState<TagItem[]>([])
  const [showWorkspaceInvite, setShowWorkspaceInvite] = useState(false)
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<
    Array<{ workspaceId: string; permission: string }>
  >([])
  const [createOrgDialogOpen, setCreateOrgDialogOpen] = useState(false)
  const [removeMemberDialog, setRemoveMemberDialog] = useState<{
    open: boolean
    memberId: string
    memberName: string
    shouldReduceSeats: boolean
    isSelfRemoval?: boolean
  }>({ open: false, memberId: '', memberName: '', shouldReduceSeats: false })
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [transferPortalError, setTransferPortalError] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [isAddSeatDialogOpen, setIsAddSeatDialogOpen] = useState(false)
  const [newSeatCount, setNewSeatCount] = useState(1)
  const [isUpdatingSeats, setIsUpdatingSeats] = useState(false)

  const { data: adminWorkspaces = [], isLoading: isLoadingWorkspaces } = useAdminWorkspaces(
    session?.user?.id,
    activeOrganization?.id
  )

  const adminOrOwner = isAdminOrOwner(organization, session?.user?.email)
  const usedSeats = getUsedSeats(organization)
  const totalSeats = organizationBillingData?.data?.totalSeats ?? 0

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

  const handleInviteMember = useCallback(async () => {
    const validEmails = inviteEmails.filter((e) => e.isValid).map((e) => e.value)
    if (!session?.user || !activeOrganization?.id || validEmails.length === 0) return
    if (selectedWorkspaces.length === 0) {
      setShowWorkspaceInvite(true)
      return
    }

    try {
      const workspaceInvitations = selectedWorkspaces.map((w) => ({
        workspaceId: w.workspaceId,
        permission: w.permission as 'admin' | 'write' | 'read',
      }))

      await inviteMutation.mutateAsync({
        emails: validEmails,
        orgId: activeOrganization.id,
        workspaceInvitations,
      })

      setInviteSuccess(true)
      setTimeout(() => setInviteSuccess(false), 3000)

      setInviteEmails([])
      setSelectedWorkspaces([])
      setShowWorkspaceInvite(false)
    } catch (error) {
      logger.error('Failed to invite member', error)
    }
  }, [session?.user?.id, activeOrganization?.id, inviteEmails, selectedWorkspaces, inviteMutation])

  const handleWorkspaceToggle = useCallback((workspaceId: string, permission: string) => {
    setSelectedWorkspaces((prev) => {
      const exists = prev.find((w) => w.workspaceId === workspaceId)

      if (!permission || permission === '') {
        return prev.filter((w) => w.workspaceId !== workspaceId)
      }

      if (exists) {
        return prev.map((w) => (w.workspaceId === workspaceId ? { ...w, permission } : w))
      }

      return [...prev, { workspaceId, permission }]
    })
  }, [])

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
        shouldReduceSeats: false,
        isSelfRemoval: isLeavingSelf,
      })
    },
    [session?.user, activeOrganization?.id]
  )

  const confirmRemoveMember = useCallback(
    async (shouldReduceSeats = false) => {
      const { memberId, isSelfRemoval } = removeMemberDialog
      if (!session?.user || !activeOrganization?.id || !memberId) return

      try {
        await removeMemberMutation.mutateAsync({
          memberId,
          orgId: activeOrganization?.id,
          shouldReduceSeats,
        })
        setRemoveMemberDialog({
          open: false,
          memberId: '',
          memberName: '',
          shouldReduceSeats: false,
        })

        if (isSelfRemoval) {
          window.location.href = '/workspace'
        }
      } catch (error) {
        logger.error('Failed to remove member', error)
      }
    },
    [
      removeMemberDialog.memberId,
      removeMemberDialog.isSelfRemoval,
      session?.user?.id,
      activeOrganization?.id,
      removeMemberMutation,
    ]
  )

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

  const handleAddSeatDialog = useCallback(() => {
    if (subscriptionData && !checkEnterprisePlan(subscriptionData)) {
      setNewSeatCount(totalSeats + 1)
      setIsAddSeatDialogOpen(true)
    }
  }, [subscriptionData, totalSeats])

  const confirmAddSeats = useCallback(
    async (selectedSeats?: number) => {
      if (!subscriptionData || !activeOrganization?.id) return

      const seatsToUse = selectedSeats || newSeatCount
      setIsUpdatingSeats(true)

      try {
        await updateSeatsMutation.mutateAsync({
          orgId: activeOrganization?.id,
          seats: seatsToUse,
        })
        setIsAddSeatDialogOpen(false)
      } catch (error) {
        logger.error('Failed to add seats', error)
      } finally {
        setIsUpdatingSeats(false)
      }
    },
    [subscriptionData, activeOrganization?.id, newSeatCount, updateSeatsMutation]
  )

  const queryError = orgError || subscriptionError
  const errorMessage = queryError instanceof Error ? queryError.message : null
  const displayOrganization = organization || activeOrganization

  if (isLoading && !displayOrganization && !(hasTeamPlan || hasEnterprisePlan)) {
    return (
      <div className='flex h-full flex-col gap-4.5'>
        {/* Team Seats Overview */}
        <div>
          <div className='rounded-lg border bg-[var(--surface-3)] p-4 shadow-xs'>
            <div className='space-y-3'>
              <div className='flex items-center justify-between'>
                <Skeleton className='h-5 w-24' />
                <Skeleton className='h-8 w-20 rounded-md' />
              </div>
              <div className='flex items-center gap-4.5'>
                <div className='flex flex-col gap-1'>
                  <Skeleton className='h-3 w-16' />
                  <Skeleton className='h-6 w-8' />
                </div>
                <div className='h-8 w-px bg-[var(--border)]' />
                <div className='flex flex-col gap-1'>
                  <Skeleton className='h-3 w-20' />
                  <Skeleton className='h-6 w-8' />
                </div>
                <div className='h-8 w-px bg-[var(--border)]' />
                <div className='flex flex-col gap-1'>
                  <Skeleton className='h-3 w-24' />
                  <Skeleton className='h-6 w-12' />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Team Members */}
        <div>
          <Skeleton className='mb-3 h-5 w-32' />
          <div className='space-y-2'>
            {[...Array(3)].map((_, i) => (
              <div key={i} className='flex items-center justify-between rounded-lg border p-3'>
                <div className='flex items-center gap-3'>
                  <Skeleton className='h-10 w-10 rounded-full' />
                  <div className='space-y-1'>
                    <Skeleton className='h-4 w-32' />
                    <Skeleton className='h-3 w-24' />
                  </div>
                </div>
                <Skeleton className='h-6 w-16 rounded-full' />
              </div>
            ))}
          </div>
        </div>

        {/* Invite Member Card */}
        <div>
          <div className='rounded-lg border bg-[var(--surface-3)] p-4'>
            <Skeleton className='mb-3 h-5 w-32' />
            <div className='space-y-3'>
              <Skeleton className='h-9 w-full rounded-lg' />
              <Skeleton className='h-9 w-full rounded-lg' />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!displayOrganization) {
    return (
      <NoOrganizationView
        hasTeamPlan={hasTeamPlan}
        hasEnterprisePlan={hasEnterprisePlan}
        orgName={orgName}
        setOrgName={setOrgName}
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
    <div className='flex h-full flex-col gap-5'>
      <div>
        <TeamSeatsOverview
          subscriptionData={subscriptionData || null}
          isLoadingSubscription={isLoadingSubscription}
          totalSeats={totalSeats}
          usedSeats={usedSeats.used}
          isLoading={isLoading}
          onAddSeatDialog={handleAddSeatDialog}
        />
      </div>

      {!isInvitationsDisabled && (
        <div>
          <MemberInvitationCard
            inviteEmails={inviteEmails}
            setInviteEmails={setInviteEmails}
            isInviting={inviteMutation.isPending}
            showWorkspaceInvite={showWorkspaceInvite}
            setShowWorkspaceInvite={setShowWorkspaceInvite}
            selectedWorkspaces={selectedWorkspaces}
            userWorkspaces={adminWorkspaces}
            onInviteMember={handleInviteMember}
            onLoadUserWorkspaces={async () => {}}
            onWorkspaceToggle={handleWorkspaceToggle}
            inviteSuccess={inviteSuccess}
            availableSeats={Math.max(0, totalSeats - usedSeats.used)}
            maxSeats={totalSeats}
            invitationError={inviteMutation.error}
            isLoadingWorkspaces={isLoadingWorkspaces}
          />
        </div>
      )}

      <OrganizationRoster
        organizationId={displayOrganization.id}
        roster={roster ?? null}
        isLoadingRoster={isLoadingRoster}
        currentUserEmail={session?.user?.email ?? ''}
        currentUserId={session?.user?.id ?? ''}
        isAdminOrOwner={adminOrOwner}
        onRemoveMember={handleRemoveMember}
        onTransferOwnership={handleOpenTransferDialog}
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
        hasPaidSubscription={Boolean(subscriptionData)}
        isOpeningBillingPortal={openBillingPortal.isPending}
        onConfirm={handleConfirmTransfer}
        onOpenBillingPortal={handleOpenTransferBillingPortal}
      />

      <RemoveMemberDialog
        open={removeMemberDialog.open}
        memberName={removeMemberDialog.memberName}
        shouldReduceSeats={removeMemberDialog.shouldReduceSeats}
        isSelfRemoval={removeMemberDialog.isSelfRemoval}
        error={removeMemberMutation.error}
        onOpenChange={(open: boolean) => {
          if (!open) setRemoveMemberDialog({ ...removeMemberDialog, open: false })
        }}
        onShouldReduceSeatsChange={(shouldReduce: boolean) =>
          setRemoveMemberDialog({
            ...removeMemberDialog,
            shouldReduceSeats: shouldReduce,
          })
        }
        onConfirmRemove={confirmRemoveMember}
        onCancel={() =>
          setRemoveMemberDialog({
            open: false,
            memberId: '',
            memberName: '',
            shouldReduceSeats: false,
            isSelfRemoval: false,
          })
        }
      />

      {subscriptionData && !checkEnterprisePlan(subscriptionData) && (
        <TeamSeats
          open={isAddSeatDialogOpen}
          onOpenChange={setIsAddSeatDialogOpen}
          title='Add Team Seats'
          description={`Each seat costs $${costPerSeat}/month and provides ${creditsPerSeat.toLocaleString()} monthly inference credits. Adjust the number of licensed seats for your team.`}
          currentSeats={totalSeats}
          initialSeats={newSeatCount}
          isLoading={isUpdatingSeats}
          error={updateSeatsMutation.error}
          onConfirm={async (selectedSeats: number) => {
            setNewSeatCount(selectedSeats)
            await confirmAddSeats(selectedSeats)
          }}
          confirmButtonText='Update Seats'
          showCostBreakdown={true}
          isCancelledAtPeriodEnd={subscriptionData?.cancelAtPeriodEnd}
          costPerSeatDollars={costPerSeat}
          creditsPerSeat={creditsPerSeat}
        />
      )}
    </div>
  )
}
