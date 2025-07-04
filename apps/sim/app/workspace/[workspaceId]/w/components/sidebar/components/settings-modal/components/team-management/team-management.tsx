import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { client, useSession } from '@/lib/auth-client'
import { checkEnterprisePlan } from '@/lib/billing/subscriptions/utils'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { TeamSeatsDialog } from '../subscription/components/team-seats-dialog'
import { TeamUsageOverview } from '../subscription/components/team-usage-overview'
import { MemberInvitationCard } from './components/member-invitation-card'
import { NoOrganizationView } from './components/no-organization-view'
import { OrganizationSettingsTab } from './components/organization-settings-tab'
import { PendingInvitationsList } from './components/pending-invitations-list'
import { RemoveMemberDialog } from './components/remove-member-dialog'
import { TeamManagementSkeleton } from './components/team-management-skeleton'
import { TeamMembersList } from './components/team-members-list'
import { TeamSeatsOverview } from './components/team-seats-overview'

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
  const [showWorkspaceInvite, setShowWorkspaceInvite] = useState(false)
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<
    Array<{ workspaceId: string; permission: string }>
  >([])
  const [userWorkspaces, setUserWorkspaces] = useState<any[]>([])
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

  // Organization settings state
  const [orgFormData, setOrgFormData] = useState({
    name: '',
    slug: '',
    logo: '',
  })
  const [isSavingOrgSettings, setIsSavingOrgSettings] = useState(false)
  const [orgSettingsError, setOrgSettingsError] = useState<string | null>(null)
  const [orgSettingsSuccess, setOrgSettingsSuccess] = useState<string | null>(null)

  const { userRole, isAdminOrOwner } = useOrganizationRole(session?.user?.email, activeOrganization)
  const { used: usedSeats } = useMemo(
    () => calculateSeatUsage(activeOrganization),
    [activeOrganization]
  )

  const [isAddSeatDialogOpen, setIsAddSeatDialogOpen] = useState(false)
  const [newSeatCount, setNewSeatCount] = useState(1)
  const [isUpdatingSeats, setIsUpdatingSeats] = useState(false)

  const loadData = useCallback(async () => {
    if (!session?.user) return

    try {
      setIsLoading(true)
      setError(null)

      // Get all organizations the user is a member of
      const orgsResponse = await client.organization.list()
      setOrganizations(orgsResponse.data || [])

      // Check if user has a team or enterprise subscription
      const response = await fetch('/api/billing?context=user')
      const result = await response.json()
      const data = result.data
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

      // Initialize organization form data
      setOrgFormData({
        name: activeOrg.name || '',
        slug: activeOrg.slug || '',
        logo: activeOrg.logo || '',
      })

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
          // If no subscription found through client API, check billing endpoint for enterprise subscriptions
          if (hasEnterprisePlan) {
            try {
              const billingResponse = await fetch('/api/billing?context=user')
              if (billingResponse.ok) {
                const billingData = await billingResponse.json()
                if (
                  billingData.success &&
                  billingData.data.isEnterprise &&
                  billingData.data.status
                ) {
                  const enterpriseSubscription = {
                    id: `subscription_${Date.now()}`, // Mock ID since billing data doesn't include subscription ID
                    plan: billingData.data.plan,
                    status: billingData.data.status,
                    seats: billingData.data.seats,
                    referenceId: billingData.data.organizationId || 'unknown',
                  }
                  logger.info('Found enterprise subscription from billing data', {
                    plan: enterpriseSubscription.plan,
                    seats: enterpriseSubscription.seats,
                  })
                  setSubscriptionData(enterpriseSubscription)
                  return
                }
              }
            } catch (err) {
              logger.error('Error fetching enterprise subscription from billing endpoint', {
                error: err,
              })
            }
          }

          logger.warn('No active subscription found for organization', {
            orgId,
          })
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

  // Load workspaces when component mounts
  useEffect(() => {
    if (session?.user && activeOrganization) {
      loadUserWorkspaces()
    }
  }, [session?.user, activeOrganization])

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
      await reduceSeats(currentSeats - 1)
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

      logger.info('Creating team organization', {
        name: orgName,
        slug: orgSlug,
      })

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

        let teamSubscription: Subscription | null =
          (userSubResponse.data?.find(
            (sub) => (sub.plan === 'team' || sub.plan === 'enterprise') && sub.status === 'active'
          ) as Subscription | undefined) || null

        // If no subscription was found through the client API but user has enterprise plan,
        // fetch it from the consolidated billing endpoint
        if (!teamSubscription && hasEnterprisePlan) {
          logger.info('No subscription found via client API, checking billing endpoint')
          try {
            const billingResponse = await fetch('/api/billing?context=user')
            if (billingResponse.ok) {
              const billingData = await billingResponse.json()
              if (billingData.success && billingData.data.isEnterprise && billingData.data.status) {
                teamSubscription = {
                  id: `subscription_${Date.now()}`, // Mock ID since billing data doesn't include subscription ID
                  plan: billingData.data.plan,
                  status: billingData.data.status,
                  seats: billingData.data.seats,
                  referenceId: billingData.data.organizationId || 'unknown',
                }
                logger.info('Found enterprise subscription via billing endpoint', {
                  plan: teamSubscription?.plan,
                  seats: teamSubscription?.seats,
                })
              }
            }
          } catch (err) {
            logger.error('Error fetching enterprise subscription from billing endpoint', {
              error: err,
            })
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
              `/api/users/me/subscription/${teamSubscription.id}/transfer`,
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
                if (errorText?.trim().startsWith('{')) {
                  const errorData = JSON.parse(errorText)
                  errorMessage = errorData.error || errorMessage
                }
              } catch (_e) {
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

  // Load user's workspaces for workspace invitation
  const loadUserWorkspaces = async () => {
    if (!session?.user) return

    try {
      const response = await fetch('/api/workspaces')
      if (response.ok) {
        const data = await response.json()
        setUserWorkspaces(data.workspaces || [])
      }
    } catch (error) {
      logger.error('Failed to load workspaces:', error)
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
        workspaceInvitations: selectedWorkspaces,
      })

      // Use direct API call with workspace invitations if selected
      if (selectedWorkspaces.length > 0) {
        const response = await fetch(
          `/api/organizations/${activeOrganization.id}/invitations?batch=true`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: inviteEmail,
              role: 'member',
              workspaceInvitations: selectedWorkspaces,
            }),
          }
        )

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to send invitation')
        }

        logger.info('Invitation with workspace access sent successfully')
      } else {
        // Use existing client method for organization-only invitations
        const inviteResult = await client.organization.inviteMember({
          email: inviteEmail,
          role: 'member',
          organizationId: activeOrganization.id,
        })

        if (inviteResult.error) {
          throw new Error(inviteResult.error.message || 'Failed to send invitation')
        }

        logger.info('Invitation sent successfully')
      }

      // Clear the input and show success message
      setInviteEmail('')
      setSelectedWorkspaces([])
      setShowWorkspaceInvite(false)
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

  // Handle workspace selection toggle
  const handleWorkspaceToggle = (workspaceId: string, permission: string) => {
    setSelectedWorkspaces((prev) => {
      const exists = prev.find((w) => w.workspaceId === workspaceId)
      if (exists) {
        return prev.filter((w) => w.workspaceId !== workspaceId)
      }
      return [...prev, { workspaceId, permission }]
    })
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
  const confirmRemoveMember = async (shouldReduceSeats = false) => {
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
          await reduceSeats(currentSeats - 1)
        }
      }

      // Refresh the organization
      await refreshOrganization()

      // Close the dialog
      setRemoveMemberDialog({
        open: false,
        memberId: '',
        memberName: '',
        shouldReduceSeats: false,
      })
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
    }
    if (subscriptionData.plan === 'team') {
      return 'Team'
    }
    return (
      subscriptionData.plan?.charAt(0).toUpperCase() + subscriptionData.plan?.slice(1) || 'Unknown'
    )
  }

  // Handle opening the add seat dialog
  const handleAddSeatDialog = () => {
    if (subscriptionData) {
      setNewSeatCount((subscriptionData.seats || 1) + 1) // Default to current seats + 1
      setIsAddSeatDialogOpen(true)
    }
  }

  // Handle reducing seats
  const reduceSeats = async (newSeatCount: number) => {
    if (!subscriptionData || !activeOrganization) return

    try {
      setIsLoading(true)
      setError(null)

      const { error } = await client.subscription.upgrade({
        plan: 'team',
        referenceId: activeOrganization.id,
        subscriptionId: subscriptionData.id,
        seats: newSeatCount,
        successUrl: window.location.href,
        cancelUrl: window.location.href,
      })
      if (error) throw new Error(error.message || 'Failed to reduce seats')
    } finally {
      setIsLoading(false)
    }
  }

  // Confirm seat addition
  const confirmAddSeats = async (selectedSeats?: number) => {
    if (!subscriptionData || !activeOrganization) return

    const seatsToUse = selectedSeats || newSeatCount

    try {
      setIsUpdatingSeats(true)
      setError(null)

      const { error } = await client.subscription.upgrade({
        plan: 'team',
        referenceId: activeOrganization.id,
        subscriptionId: subscriptionData.id,
        seats: seatsToUse,
        successUrl: window.location.href,
        cancelUrl: window.location.href,
      })

      if (error) {
        setError(error.message || 'Failed to update seats')
      } else {
        // Close the dialog after successful upgrade
        setIsAddSeatDialogOpen(false)
        await refreshOrganization()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update seats')
    } finally {
      setIsUpdatingSeats(false)
    }
  }

  // Organization settings functions
  const handleOrgInputChange = (field: string, value: string) => {
    setOrgFormData((prev) => ({ ...prev, [field]: value }))

    // Auto-generate slug from name if user is typing in name field
    if (field === 'name' && value) {
      const autoSlug = value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Replace multiple hyphens with single
        .trim()

      setOrgFormData((prev) => ({ ...prev, slug: autoSlug }))
    }
  }

  const handleSaveOrgSettings = async () => {
    if (!activeOrganization?.id || !isAdminOrOwner) return

    // Validate form
    if (!orgFormData.name.trim()) {
      setOrgSettingsError('Organization name is required')
      return
    }

    if (!orgFormData.slug.trim()) {
      setOrgSettingsError('Organization slug is required')
      return
    }

    // Validate slug format
    const slugRegex = /^[a-z0-9-_]+$/
    if (!slugRegex.test(orgFormData.slug)) {
      setOrgSettingsError(
        'Slug can only contain lowercase letters, numbers, hyphens, and underscores'
      )
      return
    }

    try {
      setIsSavingOrgSettings(true)
      setOrgSettingsError(null)
      setOrgSettingsSuccess(null)

      const response = await fetch(`/api/organizations/${activeOrganization.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: orgFormData.name.trim(),
          slug: orgFormData.slug.trim(),
          logo: orgFormData.logo.trim() || null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update organization settings')
      }

      const result = await response.json()
      setOrgSettingsSuccess('Organization settings updated successfully')

      // Refresh organization data
      await refreshOrganization()

      // Clear success message after 3 seconds
      setTimeout(() => setOrgSettingsSuccess(null), 3000)
    } catch (error) {
      logger.error('Failed to update organization settings', { error })
      setOrgSettingsError(error instanceof Error ? error.message : 'Failed to update settings')
    } finally {
      setIsSavingOrgSettings(false)
    }
  }

  if (isLoading && !activeOrganization && !(hasTeamPlan || hasEnterprisePlan)) {
    return <TeamManagementSkeleton />
  }

  // No organization yet - show creation UI
  if (!activeOrganization) {
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
        isCreatingOrg={isCreatingOrg}
        error={error}
        createOrgDialogOpen={createOrgDialogOpen}
        setCreateOrgDialogOpen={setCreateOrgDialogOpen}
      />
    )
  }

  return (
    <div className='space-y-6 p-6'>
      <div className='flex items-center justify-between'>
        <h3 className='font-medium text-lg'>Team Management</h3>

        {organizations.length > 1 && (
          <div className='flex items-center space-x-2'>
            <select
              className='rounded-md border border-input bg-background px-3 py-2 text-sm'
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
        <Alert variant='destructive'>
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value='members'>Members</TabsTrigger>
          <TabsTrigger value='usage'>Usage</TabsTrigger>
          <TabsTrigger value='settings'>Settings</TabsTrigger>
        </TabsList>

        <TabsContent value='members' className='mt-4 space-y-4'>
          {isAdminOrOwner && (
            <MemberInvitationCard
              inviteEmail={inviteEmail}
              setInviteEmail={setInviteEmail}
              isInviting={isInviting}
              showWorkspaceInvite={showWorkspaceInvite}
              setShowWorkspaceInvite={setShowWorkspaceInvite}
              selectedWorkspaces={selectedWorkspaces}
              userWorkspaces={userWorkspaces}
              onInviteMember={handleInviteMember}
              onLoadUserWorkspaces={loadUserWorkspaces}
              onWorkspaceToggle={handleWorkspaceToggle}
              inviteSuccess={inviteSuccess}
            />
          )}

          {/* Team Seats Usage - only show to admins/owners */}
          {isAdminOrOwner && (
            <TeamSeatsOverview
              subscriptionData={subscriptionData}
              isLoadingSubscription={isLoadingSubscription}
              usedSeats={usedSeats}
              isLoading={isLoading}
              onConfirmTeamUpgrade={confirmTeamUpgrade}
              onReduceSeats={handleReduceSeats}
              onAddSeatDialog={handleAddSeatDialog}
            />
          )}

          {/* Team Members - show to all users */}
          <TeamMembersList
            organization={activeOrganization}
            currentUserEmail={session?.user?.email}
            isAdminOrOwner={isAdminOrOwner}
            onRemoveMember={handleRemoveMember}
          />

          {/* Pending Invitations - only show to admins/owners */}
          {isAdminOrOwner && (activeOrganization.invitations?.length ?? 0) > 0 && (
            <PendingInvitationsList
              organization={activeOrganization}
              onCancelInvitation={handleCancelInvitation}
            />
          )}
        </TabsContent>

        <TabsContent value='usage' className='mt-4 space-y-4'>
          <TeamUsageOverview hasAdminAccess={isAdminOrOwner} />
        </TabsContent>

        <TabsContent value='settings'>
          <OrganizationSettingsTab
            organization={activeOrganization}
            isAdminOrOwner={isAdminOrOwner}
            userRole={userRole}
            orgFormData={orgFormData}
            onOrgInputChange={handleOrgInputChange}
            onSaveOrgSettings={handleSaveOrgSettings}
            isSavingOrgSettings={isSavingOrgSettings}
            orgSettingsError={orgSettingsError}
            orgSettingsSuccess={orgSettingsSuccess}
          />
        </TabsContent>
      </Tabs>
      <RemoveMemberDialog
        open={removeMemberDialog.open}
        memberName={removeMemberDialog.memberName}
        shouldReduceSeats={removeMemberDialog.shouldReduceSeats}
        onOpenChange={(open) => {
          if (!open) setRemoveMemberDialog({ ...removeMemberDialog, open: false })
        }}
        onShouldReduceSeatsChange={(shouldReduce) =>
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
          })
        }
      />
      <TeamSeatsDialog
        open={isAddSeatDialogOpen}
        onOpenChange={setIsAddSeatDialogOpen}
        title='Add Team Seats'
        description={`Update your team size. Each seat costs $${env.TEAM_TIER_COST_LIMIT}/month and gets $${env.TEAM_TIER_COST_LIMIT} of inference credits.`}
        currentSeats={subscriptionData?.seats || 1}
        initialSeats={newSeatCount}
        isLoading={isUpdatingSeats}
        onConfirm={async (selectedSeats: number) => {
          setNewSeatCount(selectedSeats)
          await confirmAddSeats(selectedSeats)
        }}
        confirmButtonText='Update Seats'
        showCostBreakdown={true}
      />
    </div>
  )
}
