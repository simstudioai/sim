import { useCallback, useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { DEFAULT_TEAM_TIER_COST_LIMIT } from '@/lib/billing/constants'
import { checkEnterprisePlan } from '@/lib/billing/subscriptions/utils'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { generateSlug, getUsedSeats, getUserRole, isAdminOrOwner } from '@/lib/organization'
import {
  MemberInvitationCard,
  NoOrganizationView,
  RemoveMemberDialog,
  TeamMembers,
  TeamSeats,
  TeamSeatsOverview,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components-new/settings-modal/components/team-management/components'
import {
  useCreateOrganization,
  useInviteMember,
  useOrganization,
  useOrganizationSubscription,
  useOrganizations,
  useRemoveMember,
  useUpdateSeats,
} from '@/hooks/queries/organization'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import { useAdminWorkspaces } from '@/hooks/queries/workspace'

const logger = createLogger('TeamManagement')

export function TeamManagement() {
  const { data: session } = useSession()

  const { data: organizationsData } = useOrganizations()
  const activeOrganization = organizationsData?.activeOrganization
  const billingData = organizationsData?.billingData?.data
  const hasTeamPlan = billingData?.isTeam ?? false
  const hasEnterprisePlan = billingData?.isEnterprise ?? false

  const { data: userSubscriptionData } = useSubscriptionData()

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

  const inviteMutation = useInviteMember()
  const removeMemberMutation = useRemoveMember()
  const updateSeatsMutation = useUpdateSeats()
  const createOrgMutation = useCreateOrganization()

  const [inviteSuccess, setInviteSuccess] = useState(false)

  const [inviteEmail, setInviteEmail] = useState('')
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
  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [isAddSeatDialogOpen, setIsAddSeatDialogOpen] = useState(false)
  const [newSeatCount, setNewSeatCount] = useState(1)
  const [isUpdatingSeats, setIsUpdatingSeats] = useState(false)

  const { data: adminWorkspaces = [], isLoading: isLoadingWorkspaces } = useAdminWorkspaces(
    session?.user?.id
  )

  const userRole = getUserRole(organization, session?.user?.email)
  const adminOrOwner = isAdminOrOwner(organization, session?.user?.email)
  const usedSeats = getUsedSeats(organization)

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
    if (!session?.user || !activeOrganization?.id || !inviteEmail.trim()) return

    try {
      const workspaceInvitations =
        selectedWorkspaces.length > 0
          ? selectedWorkspaces.map((w) => ({
              id: w.workspaceId,
              name: adminWorkspaces.find((uw) => uw.id === w.workspaceId)?.name || '',
            }))
          : undefined

      await inviteMutation.mutateAsync({
        email: inviteEmail.trim(),
        orgId: activeOrganization.id,
        workspaceInvitations,
      })

      // Show success state
      setInviteSuccess(true)
      setTimeout(() => setInviteSuccess(false), 3000)

      // Reset form
      setInviteEmail('')
      setSelectedWorkspaces([])
      setShowWorkspaceInvite(false)
    } catch (error) {
      logger.error('Failed to invite member', error)
    }
  }, [
    session?.user?.id,
    activeOrganization?.id,
    inviteEmail,
    selectedWorkspaces,
    adminWorkspaces,
    inviteMutation,
  ])

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
    async (member: any) => {
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
      const { memberId } = removeMemberDialog
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
      } catch (error) {
        logger.error('Failed to remove member', error)
      }
    },
    [removeMemberDialog.memberId, session?.user?.id, activeOrganization?.id, removeMemberMutation]
  )

  const handleReduceSeats = useCallback(async () => {
    if (!session?.user || !activeOrganization?.id || !subscriptionData) return
    if (checkEnterprisePlan(subscriptionData)) return

    const currentSeats = subscriptionData.seats || 0
    if (currentSeats <= 1) return

    const { used: totalCount } = usedSeats
    if (totalCount >= currentSeats) return

    try {
      await updateSeatsMutation.mutateAsync({
        orgId: activeOrganization?.id,
        seats: currentSeats - 1,
        subscriptionId: subscriptionData.id,
      })
    } catch (error) {
      logger.error('Failed to reduce seats', error)
    }
  }, [session?.user?.id, activeOrganization?.id, subscriptionData, usedSeats, updateSeatsMutation])

  const handleAddSeatDialog = useCallback(() => {
    if (subscriptionData) {
      setNewSeatCount((subscriptionData.seats || 1) + 1)
      setIsAddSeatDialogOpen(true)
    }
  }, [subscriptionData?.seats])

  const confirmAddSeats = useCallback(
    async (selectedSeats?: number) => {
      if (!subscriptionData || !activeOrganization?.id) return

      const seatsToUse = selectedSeats || newSeatCount
      setIsUpdatingSeats(true)

      try {
        await updateSeatsMutation.mutateAsync({
          orgId: activeOrganization?.id,
          seats: seatsToUse,
          subscriptionId: subscriptionData.id,
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

  const confirmTeamUpgrade = useCallback(
    async (seats: number) => {
      if (!session?.user || !activeOrganization?.id) return
      logger.info('Team upgrade requested', { seats, organizationId: activeOrganization?.id })
      alert(`Team upgrade to ${seats} seats - integration needed`)
    },
    [session?.user?.id, activeOrganization?.id]
  )

  const queryError = orgError || subscriptionError
  const errorMessage = queryError instanceof Error ? queryError.message : null
  const displayOrganization = organization || activeOrganization

  if (isLoading && !displayOrganization && !(hasTeamPlan || hasEnterprisePlan)) {
    return (
      <div className='flex h-full flex-col'>
        <div className='flex flex-1 flex-col overflow-y-auto px-6 pt-4 pb-4'>
          {/* Team Seats Overview */}
          <div className='mb-4'>
            <div className='rounded-[8px] border bg-background p-4 shadow-xs'>
              <div className='space-y-3'>
                <div className='flex items-center justify-between'>
                  <Skeleton className='h-5 w-24' />
                  <Skeleton className='h-8 w-20 rounded-[6px]' />
                </div>
                <div className='flex items-center gap-4'>
                  <div className='flex flex-col gap-1'>
                    <Skeleton className='h-3 w-16' />
                    <Skeleton className='h-6 w-8' />
                  </div>
                  <div className='h-8 w-px bg-border' />
                  <div className='flex flex-col gap-1'>
                    <Skeleton className='h-3 w-20' />
                    <Skeleton className='h-6 w-8' />
                  </div>
                  <div className='h-8 w-px bg-border' />
                  <div className='flex flex-col gap-1'>
                    <Skeleton className='h-3 w-24' />
                    <Skeleton className='h-6 w-12' />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Team Members */}
          <div className='mb-4'>
            <Skeleton className='mb-3 h-5 w-32' />
            <div className='space-y-2'>
              {[...Array(3)].map((_, i) => (
                <div key={i} className='flex items-center justify-between rounded-[8px] border p-3'>
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
          <div className='mb-4'>
            <div className='rounded-[8px] border bg-background p-4'>
              <Skeleton className='mb-3 h-5 w-32' />
              <div className='space-y-3'>
                <Skeleton className='h-9 w-full rounded-[8px]' />
                <Skeleton className='h-9 w-full rounded-[8px]' />
              </div>
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

  return (
    <div className='flex h-full flex-col'>
      <div className='flex flex-1 flex-col overflow-y-auto px-6 pt-4 pb-4'>
        {/* Seats Overview - Full Width */}
        {adminOrOwner && (
          <div className='mb-4'>
            <TeamSeatsOverview
              subscriptionData={subscriptionData || null}
              isLoadingSubscription={isLoadingSubscription}
              usedSeats={usedSeats.used}
              isLoading={isLoading}
              onConfirmTeamUpgrade={confirmTeamUpgrade}
              onReduceSeats={handleReduceSeats}
              onAddSeatDialog={handleAddSeatDialog}
            />
          </div>
        )}

        {/* Action: Invite New Members */}
        {adminOrOwner && (
          <div className='mb-4'>
            <MemberInvitationCard
              inviteEmail={inviteEmail}
              setInviteEmail={setInviteEmail}
              isInviting={inviteMutation.isPending}
              showWorkspaceInvite={showWorkspaceInvite}
              setShowWorkspaceInvite={setShowWorkspaceInvite}
              selectedWorkspaces={selectedWorkspaces}
              userWorkspaces={adminWorkspaces}
              onInviteMember={handleInviteMember}
              onLoadUserWorkspaces={async () => {}} // No-op: data is auto-loaded by React Query
              onWorkspaceToggle={handleWorkspaceToggle}
              inviteSuccess={inviteSuccess}
              availableSeats={Math.max(0, (subscriptionData?.seats || 0) - usedSeats.used)}
              maxSeats={subscriptionData?.seats || 0}
              invitationError={inviteMutation.error}
              isLoadingWorkspaces={isLoadingWorkspaces}
            />
          </div>
        )}

        {/* Main Content: Team Members */}
        <div className='mb-4'>
          <TeamMembers
            organization={displayOrganization}
            currentUserEmail={session?.user?.email ?? ''}
            isAdminOrOwner={adminOrOwner}
            onRemoveMember={handleRemoveMember}
          />
        </div>

        {/* Additional Info - Subtle and collapsed */}
        <div className='space-y-3'>
          {/* Single Organization Notice */}
          {adminOrOwner && (
            <div className='rounded-lg border border-[var(--border-muted)] bg-[var(--surface-3)] p-3'>
              <p className='text-muted-foreground text-xs'>
                <span className='font-medium'>Note:</span> Users can only be part of one
                organization at a time.
              </p>
            </div>
          )}

          {/* Team Information */}
          <details className='group rounded-lg border border-[var(--border-muted)] bg-[var(--surface-3)]'>
            <summary className='flex cursor-pointer items-center justify-between rounded-lg p-3 font-medium text-sm hover:bg-[var(--surface-4)] group-open:rounded-b-none'>
              <span>Team Information</span>
              <svg
                className='h-4 w-4 transition-transform group-open:rotate-180'
                fill='none'
                viewBox='0 0 24 24'
                stroke='currentColor'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M19 9l-7 7-7-7'
                />
              </svg>
            </summary>
            <div className='space-y-2 border-[var(--border-muted)] border-t p-3 text-xs'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Team ID:</span>
                <span className='font-mono text-[10px]'>{displayOrganization.id}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Created:</span>
                <span>{new Date(displayOrganization.createdAt).toLocaleDateString()}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Your Role:</span>
                <span className='font-medium capitalize'>{userRole}</span>
              </div>
            </div>
          </details>

          {/* Team Billing Information (only show for Team Plan, not Enterprise) */}
          {hasTeamPlan && !hasEnterprisePlan && (
            <details className='group rounded-lg border border-[var(--border-muted)] bg-[var(--surface-3)]'>
              <summary className='flex cursor-pointer items-center justify-between rounded-lg p-3 font-medium text-sm hover:bg-[var(--surface-4)] group-open:rounded-b-none'>
                <span>Billing Information</span>
                <svg
                  className='h-4 w-4 transition-transform group-open:rotate-180'
                  fill='none'
                  viewBox='0 0 24 24'
                  stroke='currentColor'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M19 9l-7 7-7-7'
                  />
                </svg>
              </summary>
              <div className='border-[var(--border-muted)] border-t p-3'>
                <ul className='ml-4 list-disc space-y-2 text-muted-foreground text-xs'>
                  <li>
                    Your team is billed a minimum of $
                    {(subscriptionData?.seats || 0) *
                      (env.TEAM_TIER_COST_LIMIT ?? DEFAULT_TEAM_TIER_COST_LIMIT)}
                    /month for {subscriptionData?.seats || 0} licensed seats
                  </li>
                  <li>All team member usage is pooled together from a shared limit</li>
                  <li>
                    When pooled usage exceeds the limit, all members are blocked from using the
                    service
                  </li>
                  <li>You can increase the usage limit to allow for higher usage</li>
                  <li>
                    Any usage beyond the minimum seat cost is billed as overage at the end of the
                    billing period
                  </li>
                </ul>
              </div>
            </details>
          )}
        </div>
      </div>

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

      <TeamSeats
        open={isAddSeatDialogOpen}
        onOpenChange={setIsAddSeatDialogOpen}
        title='Add Team Seats'
        description={`Each seat costs $${env.TEAM_TIER_COST_LIMIT ?? DEFAULT_TEAM_TIER_COST_LIMIT}/month and provides $${env.TEAM_TIER_COST_LIMIT ?? DEFAULT_TEAM_TIER_COST_LIMIT} in monthly inference credits. Adjust the number of licensed seats for your team.`}
        currentSeats={subscriptionData?.seats || 1}
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
      />
    </div>
  )
}
