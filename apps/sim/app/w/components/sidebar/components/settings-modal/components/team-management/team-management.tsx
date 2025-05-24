import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle, Copy, PlusCircle, RefreshCw, UserX, XCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { client, useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { checkEnterprisePlan } from '@/lib/subscription/utils'

const logger = createLogger('TeamManagement')

type User = { name?: string; email?: string }

type Member = {
  id: string
  role: string
  user?: User
}

type Invitation = {
  id: string
  email: string
  status: string
}

type Organization = {
  id: string
  name: string
  slug: string
  members?: Member[]
  invitations?: Invitation[]
  createdAt: string | Date
  [key: string]: unknown
}

interface SubscriptionMetadata {
  perSeatAllowance?: number
  totalAllowance?: number
  [key: string]: unknown
}

type Subscription = {
  id: string
  plan: string
  status: string
  seats?: number
  referenceId: string
  cancelAtPeriodEnd?: boolean
  periodEnd?: number | Date
  trialEnd?: number | Date
  metadata?: SubscriptionMetadata
  [key: string]: unknown
}

function calculateSeatUsage(org?: Organization | null) {
  const members = org?.members?.length ?? 0
  const pending = org?.invitations?.filter((inv) => inv.status === 'pending').length ?? 0
  return { used: members + pending, members, pending }
}

function useOrganizationRole(userEmail: string | undefined, org: Organization | null | undefined) {
  return useMemo(() => {
    if (!userEmail || !org?.members) {
      return { userRole: 'member', isAdminOrOwner: false }
    }
    const currentMember = org.members.find((m) => m.user?.email === userEmail)
    const role = currentMember?.role ?? 'member'
    return {
      userRole: role,
      isAdminOrOwner: role === 'owner' || role === 'admin',
    }
  }, [userEmail, org])
}

export function TeamManagement() {
  const { data: session } = useSession()
  const { data: activeOrg } = client.useActiveOrganization()

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [organizations, setOrganizations] = useState<any[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [isInviting, setIsInviting] = useState(false)
  const [isCreatingOrg, setIsCreatingOrg] = useState(false)
  const [createOrgDialogOpen, setCreateOrgDialogOpen] = useState(false)
  const [removeMemberDialog, setRemoveMemberDialog] = useState<{
    open: boolean
    memberId: string
    memberName: string
    shouldReduceSeats: boolean
  }>({ open: false, memberId: '', memberName: '', shouldReduceSeats: false })
  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [activeTab, setActiveTab] = useState('members')
  const [activeOrganization, setActiveOrganization] = useState<Organization | null>(null)
  const [subscriptionData, setSubscriptionData] = useState<Subscription | null>(null)
  const [isLoadingSubscription, setIsLoadingSubscription] = useState(false)
  const [hasTeamPlan, setHasTeamPlan] = useState(false)
  const [hasEnterprisePlan, setHasEnterprisePlan] = useState(false)
  const { userRole, isAdminOrOwner } = useOrganizationRole(session?.user?.email, activeOrganization)
  const { used: usedSeats } = useMemo(
    () => calculateSeatUsage(activeOrganization),
    [activeOrganization]
  )

  const loadData = useCallback(async () => {
    if (!session?.user) return

    try {
      setIsLoading(true)
      setError(null)

      // Get all organizations the user is a member of
      const orgsResponse = await client.organization.list()
      setOrganizations(orgsResponse.data || [])

      // Check if user has a team or enterprise subscription
      const response = await fetch('/api/user/subscription')
      const data = await response.json()
      setHasTeamPlan(data.isTeam)
      setHasEnterprisePlan(data.isEnterprise)

      // Set default organization name and slug for organization creation
      // but no longer automatically showing the dialog
      if (data.isTeam || data.isEnterprise) {
        setOrgName(`${session.user.name || 'My'}'s Team`)
        setOrgSlug(generateSlug(`${session.user.name || 'My'}'s Team`))
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load data')
      logger.error('Failed to load data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [session?.user])

  // Update local state when the active organization changes
  useEffect(() => {
    if (activeOrg) {
      setActiveOrganization(activeOrg)

      // Load subscription data for the organization
      if (activeOrg.id) {
        loadOrganizationSubscription(activeOrg.id)
      }
    }
  }, [activeOrg])

  // Load organization's subscription data
  const loadOrganizationSubscription = async (orgId: string) => {
    try {
      setIsLoadingSubscription(true)
      logger.info('Loading subscription for organization', { orgId })

      const { data, error } = await client.subscription.list({
        query: { referenceId: orgId },
      })

      if (error) {
        logger.error('Error fetching organization subscription', { error })
        setError('Failed to load subscription data')
      } else {
        logger.info('Organization subscription data loaded', {
          subscriptions: data?.map((s) => ({
            id: s.id,
            plan: s.plan,
            status: s.status,
            seats: s.seats,
            referenceId: s.referenceId,
          })),
        })

        // Find active team or enterprise subscription
        const teamSubscription = data?.find((sub) => sub.status === 'active' && sub.plan === 'team')
        const enterpriseSubscription = data?.find((sub) => checkEnterprisePlan(sub))

        // Use enterprise plan if available, otherwise team plan
        const activeSubscription = enterpriseSubscription || teamSubscription

        if (activeSubscription) {
          logger.info('Found active subscription', {
            id: activeSubscription.id,
            plan: activeSubscription.plan,
            seats: activeSubscription.seats,
          })
          setSubscriptionData(activeSubscription)
        } else {
          // If no subscription found through client API, check for enterprise subscriptions
          if (hasEnterprisePlan) {
            try {
              const enterpriseResponse = await fetch('/api/user/subscription/enterprise')
              if (enterpriseResponse.ok) {
                const enterpriseData = await enterpriseResponse.json()
                if (enterpriseData.subscription) {
                  logger.info('Found enterprise subscription', {
                    id: enterpriseData.subscription.id,
                    seats: enterpriseData.subscription.seats,
                  })
                  setSubscriptionData(enterpriseData.subscription)
                  return
                }
              }
            } catch (err) {
              logger.error('Error fetching enterprise subscription', { error: err })
            }
          }

          logger.warn('No active subscription found for organization', { orgId })
          setSubscriptionData(null)
        }
      }
    } catch (err: any) {
      logger.error('Error loading subscription data', { error: err })
      setError(err.message || 'Failed to load subscription data')
    } finally {
      setIsLoadingSubscription(false)
    }
  }

  // Initial data loading
  useEffect(() => {
    loadData()
  }, [loadData])

  // Refresh organization data
  const refreshOrganization = useCallback(async () => {
    if (!activeOrganization?.id) return

    try {
      const fullOrgResponse = await client.organization.getFullOrganization()
      setActiveOrganization(fullOrgResponse.data)

      // Also refresh subscription data when organization is refreshed
      if (fullOrgResponse.data?.id) {
        await loadOrganizationSubscription(fullOrgResponse.data.id)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to refresh organization data')
    }
  }, [activeOrganization?.id])

  // Handle seat reduction - remove members when seats are reduced
  const handleReduceSeats = async () => {
    if (!session?.user || !activeOrganization || !subscriptionData) return

    // Don't allow enterprise users to modify seats
    if (checkEnterprisePlan(subscriptionData)) {
      setError('Enterprise plan seats can only be modified by contacting support')
      return
    }

    const currentSeats = subscriptionData.seats || 0
    if (currentSeats <= 1) {
      setError('Cannot reduce seats below 1')
      return
    }

    const { used: totalCount } = calculateSeatUsage(activeOrganization)

    if (totalCount >= currentSeats) {
      setError(
        `You have ${totalCount} active members/invitations. Please remove members or cancel invitations before reducing seats.`
      )
      return
    }

    try {
      await updateSeats(currentSeats - 1)
      await refreshOrganization()
    } catch (err: any) {
      setError(err.message || 'Failed to reduce seats')
    }
  }

  const generateSlug = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '-')
  }

  const handleOrgNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setOrgName(newName)
    setOrgSlug(generateSlug(newName))
  }

  const handleCreateOrganization = async () => {
    if (!session?.user) return

    try {
      setIsCreatingOrg(true)
      setError(null)

      logger.info('Creating team organization', { name: orgName, slug: orgSlug })

      // Create the organization using Better Auth API
      const result = await client.organization.create({
        name: orgName,
        slug: orgSlug,
      })

      if (!result.data?.id) {
        throw new Error('Failed to create organization')
      }

      const orgId = result.data.id
      logger.info('Organization created', { orgId })

      // Set the new organization as active
      logger.info('Setting organization as active', { orgId })
      await client.organization.setActive({
        organizationId: orgId,
      })

      // If the user has a team or enterprise subscription, update the subscription reference
      // directly through a custom API endpoint instead of using upgrade
      if (hasTeamPlan || hasEnterprisePlan) {
        const userSubResponse = await client.subscription.list()

        let teamSubscription = userSubResponse.data?.find(
          (sub) => (sub.plan === 'team' || sub.plan === 'enterprise') && sub.status === 'active'
        )

        // If no subscription was found through the client API but user has enterprise plan,
        // fetch it directly through our enterprise subscription endpoint
        if (!teamSubscription && hasEnterprisePlan) {
          logger.info('No subscription found via client API, checking enterprise endpoint')
          try {
            const enterpriseResponse = await fetch('/api/user/subscription/enterprise')
            if (enterpriseResponse.ok) {
              const enterpriseData = await enterpriseResponse.json()
              if (enterpriseData.subscription) {
                teamSubscription = enterpriseData.subscription
                logger.info('Found enterprise subscription via direct API', {
                  subscriptionId: teamSubscription?.id,
                  plan: teamSubscription?.plan,
                  seats: teamSubscription?.seats,
                })
              }
            }
          } catch (err) {
            logger.error('Error fetching enterprise subscription details', { error: err })
          }
        }

        logger.info('Team subscription to transfer', {
          found: !!teamSubscription,
          details: teamSubscription
            ? {
                id: teamSubscription.id,
                plan: teamSubscription.plan,
                status: teamSubscription.status,
              }
            : null,
        })

        if (teamSubscription) {
          logger.info('Found subscription to transfer', {
            subscriptionId: teamSubscription.id,
            plan: teamSubscription.plan,
            seats: teamSubscription.seats,
            targetOrgId: orgId,
          })

          // Use a custom API endpoint to transfer the subscription without going to Stripe
          try {
            const transferResponse = await fetch(
              `/api/user/subscription/${teamSubscription.id}/transfer`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  organizationId: orgId,
                }),
              }
            )

            if (!transferResponse.ok) {
              const errorText = await transferResponse.text()
              let errorMessage = 'Failed to transfer subscription'

              try {
                if (errorText && errorText.trim().startsWith('{')) {
                  const errorData = JSON.parse(errorText)
                  errorMessage = errorData.error || errorMessage
                }
              } catch (e) {
                // Parsing failed, use the raw text
                errorMessage = errorText || errorMessage
              }

              throw new Error(errorMessage)
            }
          } catch (transferError) {
            logger.error('Subscription transfer failed', {
              error: transferError instanceof Error ? transferError.message : String(transferError),
            })
            throw transferError
          }
        }
      }

      // Refresh the organization list
      await loadData()

      // Close the dialog
      setCreateOrgDialogOpen(false)
      setOrgName('')
      setOrgSlug('')
    } catch (err: any) {
      logger.error('Failed to create organization', { error: err })
      setError(err.message || 'Failed to create organization')
    } finally {
      setIsCreatingOrg(false)
    }
  }

  // Upgrade to team subscription with organization as reference
  const confirmTeamUpgrade = async (seats: number) => {
    if (!session?.user || !activeOrganization) return

    try {
      setIsLoading(true)
      setError(null)

      // Use the organization's ID as the reference for the team subscription
      const { error } = await client.subscription.upgrade({
        plan: 'team',
        referenceId: activeOrganization.id,
        successUrl: window.location.href,
        cancelUrl: window.location.href,
        seats: seats,
      })

      if (error) {
        setError(error.message || 'Failed to upgrade to team subscription')
      } else {
        await refreshOrganization()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to upgrade to team subscription')
    } finally {
      setIsLoading(false)
    }
  }

  // Set an organization as active
  const handleSetActiveOrg = async (orgId: string) => {
    if (!session?.user) return

    try {
      setIsLoading(true)

      // Set the active organization
      await client.organization.setActive({
        organizationId: orgId,
      })
    } catch (err: any) {
      setError(err.message || 'Failed to set active organization')
    } finally {
      setIsLoading(false)
    }
  }

  // Invite a member to the organization
  const handleInviteMember = async () => {
    if (!session?.user || !activeOrganization) return

    try {
      setIsInviting(true)
      setError(null)
      setInviteSuccess(false)

      const {
        used: totalCount,
        pending: pendingInvitationCount,
        members: currentMemberCount,
      } = calculateSeatUsage(activeOrganization)

      const seatLimit = subscriptionData?.seats || 0

      logger.info('Checking seat availability for invitation', {
        currentMembers: currentMemberCount,
        pendingInvites: pendingInvitationCount,
        totalUsed: totalCount,
        seatLimit,
        subscriptionId: subscriptionData?.id,
      })

      if (totalCount >= seatLimit) {
        setError(
          `You've reached your team seat limit of ${seatLimit}. Please upgrade your plan for more seats.`
        )
        return
      }

      if (!inviteEmail || !inviteEmail.includes('@')) {
        setError('Please enter a valid email address')
        return
      }

      logger.info('Sending invitation to member', {
        email: inviteEmail,
        organizationId: activeOrganization.id,
      })

      // Invite the member
      const inviteResult = await client.organization.inviteMember({
        email: inviteEmail,
        role: 'member',
        organizationId: activeOrganization.id,
      })

      if (inviteResult.error) {
        throw new Error(inviteResult.error.message || 'Failed to send invitation')
      }

      logger.info('Invitation sent successfully')

      // Clear the input and show success message
      setInviteEmail('')
      setInviteSuccess(true)

      // Refresh the organization
      await refreshOrganization()
    } catch (err: any) {
      logger.error('Error inviting member', { error: err })
      setError(err.message || 'Failed to invite member')
    } finally {
      setIsInviting(false)
    }
  }

  // Remove a member from the organization
  const handleRemoveMember = async (member: any) => {
    if (!session?.user || !activeOrganization) return

    // Open confirmation dialog
    setRemoveMemberDialog({
      open: true,
      memberId: member.id,
      memberName: member.user?.name || member.user?.email || 'this member',
      shouldReduceSeats: false,
    })
  }

  // Actual member removal after confirmation
  const confirmRemoveMember = async (shouldReduceSeats: boolean = false) => {
    const { memberId } = removeMemberDialog
    if (!session?.user || !activeOrganization || !memberId) return

    try {
      setIsLoading(true)

      // Remove the member
      await client.organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId: activeOrganization.id,
      })

      // If the user opted to reduce seats as well
      if (shouldReduceSeats && subscriptionData) {
        const currentSeats = subscriptionData.seats || 0
        if (currentSeats > 1) {
          try {
            await updateSeats(currentSeats - 1)
          } catch (err) {
            throw err
          }
        }
      }

      // Refresh the organization
      await refreshOrganization()

      // Close the dialog
      setRemoveMemberDialog({ open: false, memberId: '', memberName: '', shouldReduceSeats: false })
    } catch (err: any) {
      setError(err.message || 'Failed to remove member')
    } finally {
      setIsLoading(false)
    }
  }

  // Cancel an invitation
  const handleCancelInvitation = async (invitationId: string) => {
    if (!session?.user || !activeOrganization) return

    try {
      setIsLoading(true)

      // Cancel the invitation
      await client.organization.cancelInvitation({
        invitationId,
      })

      // Refresh the organization
      await refreshOrganization()
    } catch (err: any) {
      setError(err.message || 'Failed to cancel invitation')
    } finally {
      setIsLoading(false)
    }
  }

  const getEffectivePlanName = () => {
    if (!subscriptionData) return 'No Plan'

    if (checkEnterprisePlan(subscriptionData)) {
      return 'Enterprise'
    } else if (subscriptionData.plan === 'team') {
      return 'Team'
    } else {
      return (
        subscriptionData.plan?.charAt(0).toUpperCase() + subscriptionData.plan?.slice(1) ||
        'Unknown'
      )
    }
  }

  const updateSeats = useCallback(
    async (newSeatCount: number) => {
      if (!subscriptionData || !activeOrganization) return

      // Don't allow enterprise users to modify seats
      if (checkEnterprisePlan(subscriptionData)) {
        setError('Enterprise plan seats can only be modified by contacting support')
        return
      }

      try {
        setIsLoading(true)
        setError(null)

        const { error } = await client.subscription.upgrade({
          plan: 'team',
          referenceId: activeOrganization.id,
          successUrl: window.location.href,
          cancelUrl: window.location.href,
          seats: newSeatCount,
        })
        if (error) throw new Error(error.message || 'Failed to update seats')
      } finally {
        setIsLoading(false)
      }
    },
    [subscriptionData, activeOrganization]
  )

  if (isLoading && !activeOrganization && !(hasTeamPlan || hasEnterprisePlan)) {
    return <TeamManagementSkeleton />
  }

  const getInvitationStatus = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <div className="flex items-center text-amber-500">
            <RefreshCw className="w-4 h-4 mr-1" />
            <span>Pending</span>
          </div>
        )
      case 'accepted':
        return (
          <div className="flex items-center text-green-500">
            <CheckCircle className="w-4 h-4 mr-1" />
            <span>Accepted</span>
          </div>
        )
      case 'canceled':
        return (
          <div className="flex items-center text-red-500">
            <XCircle className="w-4 h-4 mr-1" />
            <span>Canceled</span>
          </div>
        )
      default:
        return status
    }
  }

  // No organization yet - show creation UI
  if (!activeOrganization) {
    return (
      <div className="p-6 space-y-6">
        <div className="space-y-6">
          <h3 className="text-lg font-medium">
            {hasTeamPlan || hasEnterprisePlan ? 'Create Your Team Workspace' : 'No Team Workspace'}
          </h3>

          {hasTeamPlan || hasEnterprisePlan ? (
            <div className="border rounded-lg p-6 space-y-6">
              <p className="text-sm text-muted-foreground">
                You're subscribed to a {hasEnterprisePlan ? 'enterprise' : 'team'} plan. Create your
                workspace to start collaborating with your team.
              </p>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Team Name</label>
                  <Input value={orgName} onChange={handleOrgNameChange} placeholder="My Team" />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Team URL</label>
                  <div className="flex items-center space-x-2">
                    <div className="bg-muted px-3 py-2 rounded-l-md text-sm text-muted-foreground">
                      simstudio.ai/team/
                    </div>
                    <Input
                      value={orgSlug}
                      onChange={(e) => setOrgSlug(e.target.value)}
                      className="rounded-l-none"
                    />
                  </div>
                </div>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end space-x-2">
                <Button
                  onClick={handleCreateOrganization}
                  disabled={!orgName || !orgSlug || isCreatingOrg}
                >
                  {isCreatingOrg && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
                  Create Team Workspace
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                You don't have a team workspace yet. To collaborate with others, first upgrade to a
                team or enterprise plan.
              </p>

              <Button
                onClick={() => {
                  // Open the subscription tab
                  const event = new CustomEvent('open-settings', {
                    detail: { tab: 'subscription' },
                  })
                  window.dispatchEvent(event)
                }}
              >
                Upgrade to Team Plan
              </Button>
            </>
          )}
        </div>

        <Dialog open={createOrgDialogOpen} onOpenChange={setCreateOrgDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Team Workspace</DialogTitle>
              <DialogDescription>
                Create a workspace for your team to collaborate on projects.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Team Name</label>
                <Input value={orgName} onChange={handleOrgNameChange} placeholder="My Team" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Team URL</label>
                <div className="flex items-center space-x-2">
                  <div className="bg-muted px-3 py-2 rounded-l-md text-sm text-muted-foreground">
                    simstudio.ai/team/
                  </div>
                  <Input
                    value={orgSlug}
                    onChange={(e) => setOrgSlug(e.target.value)}
                    className="rounded-l-none"
                  />
                </div>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateOrgDialogOpen(false)}
                disabled={isCreatingOrg}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateOrganization}
                disabled={!orgName || !orgSlug || isCreatingOrg}
              >
                {isCreatingOrg && <ButtonSkeleton />}
                <span className={isCreatingOrg ? 'ml-2' : ''}>Create Team Workspace</span>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Team Management</h3>

        {organizations.length > 1 && (
          <div className="flex items-center space-x-2">
            <select
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={activeOrganization.id}
              onChange={(e) => handleSetActiveOrg(e.target.value)}
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="space-y-4 mt-4">
          {isAdminOrOwner && (
            <div className="rounded-md border p-4">
              <h4 className="text-sm font-medium mb-4">Invite Team Members</h4>

              <div className="flex items-center space-x-2">
                <Input
                  placeholder="Email address"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={isInviting}
                />
                <Button onClick={handleInviteMember} disabled={!inviteEmail || isInviting}>
                  {isInviting ? <ButtonSkeleton /> : <PlusCircle className="w-4 h-4 mr-2" />}
                  <span>Invite</span>
                </Button>
              </div>

              {inviteSuccess && (
                <p className="text-sm text-green-500 mt-2">Invitation sent successfully</p>
              )}
            </div>
          )}

          {/* Team Seats Usage - only show to admins/owners */}
          {isAdminOrOwner && (
            <div className="rounded-md border p-4">
              <h4 className="text-sm font-medium mb-2">Team Seats</h4>

              {isLoadingSubscription ? (
                <TeamSeatsSkeleton />
              ) : subscriptionData ? (
                <>
                  <div className="flex justify-between text-sm mb-2">
                    <span>Used</span>
                    <span>
                      {usedSeats}/{subscriptionData.seats || 0}
                    </span>
                  </div>
                  <Progress
                    value={(usedSeats / (subscriptionData.seats || 1)) * 100}
                    className="h-2"
                  />

                  {checkEnterprisePlan(subscriptionData) ? (
                    <div></div>
                  ) : (
                    <div className="mt-4 flex justify-between">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleReduceSeats}
                        disabled={(subscriptionData.seats || 0) <= 1 || isLoading}
                      >
                        Remove Seat
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          const currentSeats = subscriptionData.seats || 1
                          try {
                            await updateSeats(currentSeats + 1)
                            await refreshOrganization()
                          } catch (error) {
                            const errorMessage =
                              error instanceof Error ? error.message : 'Failed to update seats'
                            setError(errorMessage)
                            logger.error('Error updating seats', { error })
                          }
                        }}
                        disabled={isLoading}
                      >
                        Add Seat
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-muted-foreground space-y-2">
                  <p>No active subscription found for this organization.</p>
                  <p>
                    This might happen if your subscription was created for your personal account but
                    hasn't been properly transferred to the organization.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setError(null)
                      confirmTeamUpgrade(2) // Start with 2 seats as default
                    }}
                    disabled={isLoading}
                  >
                    Set Up Team Subscription
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Team Members - show to all users */}
          <div className="rounded-md border">
            <h4 className="text-sm font-medium p-4 border-b">Team Members</h4>

            {activeOrganization.members?.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No members in this organization yet.
              </div>
            ) : (
              <div className="divide-y">
                {activeOrganization.members?.map((member: any) => (
                  <div key={member.id} className="p-4 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{member.user?.name || 'Unknown'}</div>
                      <div className="text-sm text-muted-foreground">{member.user?.email}</div>
                      <div className="text-xs mt-1 bg-primary/10 text-primary px-2 py-0.5 rounded-full inline-block">
                        {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                      </div>
                    </div>

                    {/* Only show remove button for non-owners and if current user is admin/owner */}
                    {isAdminOrOwner &&
                      member.role !== 'owner' &&
                      member.user?.email !== session?.user?.email && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRemoveMember(member)}
                        >
                          <UserX className="w-4 h-4" />
                        </Button>
                      )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending Invitations - only show to admins/owners */}
          {isAdminOrOwner && (activeOrganization.invitations?.length ?? 0) > 0 && (
            <div className="rounded-md border">
              <h4 className="text-sm font-medium p-4 border-b">Pending Invitations</h4>

              <div className="divide-y">
                {activeOrganization.invitations?.map((invitation: any) => (
                  <div key={invitation.id} className="p-4 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{invitation.email}</div>
                      <div className="text-xs mt-1">{getInvitationStatus(invitation.status)}</div>
                    </div>

                    {invitation.status === 'pending' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCancelInvitation(invitation.id)}
                      >
                        <XCircle className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="settings" className="space-y-4 mt-4">
          <div className="rounded-md border p-4 space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-2">Team Workspace Name</h4>
              <div className="font-medium">{activeOrganization.name}</div>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-2">URL Slug</h4>
              <div className="flex items-center space-x-2">
                <code className="bg-muted px-2 py-1 rounded text-sm">
                  {activeOrganization.slug}
                </code>
                <Button variant="ghost" size="sm">
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-2">Created On</h4>
              <div className="text-sm">
                {new Date(activeOrganization.createdAt).toLocaleDateString()}
              </div>
            </div>

            {/* Only show subscription details to admins/owners */}
            {isAdminOrOwner && (
              <div>
                <h4 className="text-sm font-medium mb-2">Subscription Status</h4>
                {isLoadingSubscription ? (
                  <TeamSeatsSkeleton />
                ) : subscriptionData ? (
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          subscriptionData.status === 'active'
                            ? 'bg-green-500'
                            : subscriptionData.status === 'trialing'
                              ? 'bg-amber-500'
                              : 'bg-red-500'
                        }`}
                      ></div>
                      <span className="capitalize font-medium">
                        {getEffectivePlanName()} {subscriptionData.status}
                        {subscriptionData.cancelAtPeriodEnd ? ' (Cancels at period end)' : ''}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <div>Team seats: {subscriptionData.seats}</div>
                      {checkEnterprisePlan(subscriptionData) && subscriptionData.metadata && (
                        <div>
                          {subscriptionData.metadata.perSeatAllowance && (
                            <div>
                              Per-seat allowance: ${subscriptionData.metadata.perSeatAllowance}
                            </div>
                          )}
                          {subscriptionData.metadata.totalAllowance && (
                            <div>Total allowance: ${subscriptionData.metadata.totalAllowance}</div>
                          )}
                        </div>
                      )}
                      {subscriptionData.periodEnd && (
                        <div>
                          Next billing date:{' '}
                          {new Date(subscriptionData.periodEnd).toLocaleDateString()}
                        </div>
                      )}
                      {subscriptionData.trialEnd && (
                        <div>
                          Trial ends: {new Date(subscriptionData.trialEnd).toLocaleDateString()}
                        </div>
                      )}
                      <div className="mt-2 text-xs">
                        This subscription is associated with this team workspace.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No active subscription found</div>
                )}
              </div>
            )}

            {!isAdminOrOwner && (
              <div>
                <h4 className="text-sm font-medium mb-2">Your Role</h4>
                <div className="text-sm">
                  You are a <span className="capitalize font-medium">{userRole}</span> of this
                  workspace.
                  {userRole === 'member' && (
                    <p className="mt-2 text-muted-foreground text-xs">
                      Contact a workspace admin or owner for subscription changes or to invite new
                      members.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Member removal confirmation dialog */}
      <Dialog
        open={removeMemberDialog.open}
        onOpenChange={(open) => {
          if (!open) setRemoveMemberDialog({ ...removeMemberDialog, open: false })
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Team Member</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove {removeMemberDialog.memberName} from the team?
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="reduce-seats"
                className="rounded"
                checked={removeMemberDialog.shouldReduceSeats}
                onChange={(e) =>
                  setRemoveMemberDialog({
                    ...removeMemberDialog,
                    shouldReduceSeats: e.target.checked,
                  })
                }
              />
              <label htmlFor="reduce-seats" className="text-sm">
                Also reduce seat count in my subscription
              </label>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              If selected, your team seat count will be reduced by 1, lowering your monthly billing.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setRemoveMemberDialog({
                  open: false,
                  memberId: '',
                  memberName: '',
                  shouldReduceSeats: false,
                })
              }
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRemoveMember(removeMemberDialog.shouldReduceSeats)}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TeamManagementSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="space-y-4">
        <div className="rounded-md border p-4">
          <Skeleton className="h-5 w-32 mb-4" />
          <div className="flex items-center space-x-2">
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>

        <div className="rounded-md border p-4">
          <Skeleton className="h-5 w-32 mb-4" />
          <div className="space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-2 w-full" />
            <div className="flex justify-between mt-4">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-24" />
            </div>
          </div>
        </div>

        <div className="rounded-md border">
          <Skeleton className="h-5 w-32 p-4 border-b" />
          <div className="p-4 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="h-9 w-9" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ButtonSkeleton() {
  return <Skeleton className="h-9 w-24" />
}

function TeamSeatsSkeleton() {
  return (
    <div className="flex items-center space-x-2">
      <Skeleton className="h-4 w-4" />
      <Skeleton className="h-4 w-32" />
    </div>
  )
}
