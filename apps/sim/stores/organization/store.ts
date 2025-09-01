import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { client } from '@/lib/auth-client'
import { checkEnterprisePlan } from '@/lib/billing/subscriptions/utils'
import { getEnv, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import type {
  OrganizationStore,
  Subscription,
  WorkspaceInvitation,
} from '@/stores/organization/types'
import {
  calculateSeatUsage,
  generateSlug,
  validateEmail,
  validateSlug,
} from '@/stores/organization/utils'

const logger = createLogger('OrganizationStore')

const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))

const CACHE_DURATION = 30 * 1000

export const useOrganizationStore = create<OrganizationStore>()(
  devtools(
    (set, get) => ({
      organizations: [],
      activeOrganization: null,
      subscriptionData: null,
      userWorkspaces: [],
      organizationBillingData: null,
      orgFormData: {
        name: '',
        slug: '',
        logo: '',
      },
      isLoading: false,
      isLoadingSubscription: false,
      isLoadingOrgBilling: false,
      isCreatingOrg: false,
      isInviting: false,
      isSavingOrgSettings: false,
      error: null,
      orgSettingsError: null,
      inviteSuccess: false,
      orgSettingsSuccess: null,
      lastFetched: null,
      lastSubscriptionFetched: null,
      lastOrgBillingFetched: null,
      hasTeamPlan: false,
      hasEnterprisePlan: false,

      loadData: async () => {
        if (!isBillingEnabled) {
          logger.debug('Billing disabled, skipping organization data loading')
          set({
            organizations: [],
            activeOrganization: null,
            hasTeamPlan: false,
            hasEnterprisePlan: false,
            isLoading: false,
            error: null,
            lastFetched: Date.now(),
          })
          return
        }

        const state = get()

        if (state.lastFetched && Date.now() - state.lastFetched < CACHE_DURATION) {
          logger.debug('Using cached data')
          return
        }

        if (state.isLoading) {
          logger.debug('Data already loading, skipping duplicate request')
          return
        }

        set({ isLoading: true, error: null })

        try {
          // Load organizations, active organization, and user subscription info in parallel
          const [orgsResponse, activeOrgResponse, billingResponse] = await Promise.all([
            client.organization.list(),
            client.organization.getFullOrganization().catch(() => ({ data: null })),
            fetch('/api/billing?context=user'),
          ])

          const organizations = orgsResponse.data || []
          const activeOrganization = activeOrgResponse.data || null

          let hasTeamPlan = false
          let hasEnterprisePlan = false

          if (billingResponse.ok) {
            const billingResult = await billingResponse.json()
            const billingData = billingResult.data
            hasTeamPlan = billingData.isTeam
            hasEnterprisePlan = billingData.isEnterprise
          }

          set({
            organizations,
            activeOrganization,
            hasTeamPlan,
            hasEnterprisePlan,
            isLoading: false,
            error: null,
            lastFetched: Date.now(),
          })

          logger.debug('Organization data loaded successfully', {
            organizationCount: organizations.length,
            activeOrganizationId: activeOrganization?.id,
            hasTeamPlan,
            hasEnterprisePlan,
          })

          // Load subscription data for the active organization
          if (activeOrganization?.id) {
            await get().loadOrganizationSubscription(activeOrganization.id)
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to load organization data'
          logger.error('Failed to load organization data', { error })
          set({
            isLoading: false,
            error: errorMessage,
          })
        }
      },

      loadOrganizationSubscription: async (orgId: string) => {
        const state = get()

        if (
          state.subscriptionData &&
          state.lastSubscriptionFetched &&
          Date.now() - state.lastSubscriptionFetched < CACHE_DURATION
        ) {
          logger.debug('Using cached subscription data')
          return
        }

        if (state.isLoadingSubscription) {
          logger.debug('Subscription data already loading, skipping duplicate request')
          return
        }

        set({ isLoadingSubscription: true })

        try {
          logger.info('Loading subscription for organization', { orgId })

          const { data, error } = await client.subscription.list({
            query: { referenceId: orgId },
          })

          if (error) {
            logger.error('Error fetching organization subscription', { error })
            set({ error: 'Failed to load subscription data' })
            return
          }

          // Find active team or enterprise subscription
          const teamSubscription = data?.find(
            (sub) => sub.status === 'active' && sub.plan === 'team'
          )
          const enterpriseSubscription = data?.find((sub) => checkEnterprisePlan(sub))
          const activeSubscription = enterpriseSubscription || teamSubscription

          if (activeSubscription) {
            logger.info('Found active subscription', {
              id: activeSubscription.id,
              plan: activeSubscription.plan,
              seats: activeSubscription.seats,
            })
            set({
              subscriptionData: activeSubscription,
              isLoadingSubscription: false,
              lastSubscriptionFetched: Date.now(),
            })
          } else {
            logger.warn('No active subscription found for organization', { orgId })
            set({
              subscriptionData: null,
              isLoadingSubscription: false,
              lastSubscriptionFetched: Date.now(),
            })
          }
        } catch (error) {
          logger.error('Error loading subscription data', { error })
          set({
            error: error instanceof Error ? error.message : 'Failed to load subscription data',
            isLoadingSubscription: false,
          })
        }
      },

      loadOrganizationBillingData: async (organizationId: string, force?: boolean) => {
        const state = get()

        if (
          state.organizationBillingData &&
          state.lastOrgBillingFetched &&
          Date.now() - state.lastOrgBillingFetched < CACHE_DURATION &&
          !force
        ) {
          logger.debug('Using cached organization billing data')
          return
        }

        if (state.isLoadingOrgBilling) {
          logger.debug('Organization billing data already loading, skipping duplicate request')
          return
        }

        set({ isLoadingOrgBilling: true })

        try {
          const response = await fetch(`/api/billing?context=organization&id=${organizationId}`)

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }

          const result = await response.json()
          const data = result.data

          set({
            organizationBillingData: { ...data, userRole: result.userRole },
            isLoadingOrgBilling: false,
            lastOrgBillingFetched: Date.now(),
          })

          logger.debug('Organization billing data loaded successfully')
        } catch (error) {
          logger.error('Failed to load organization billing data', { error })
          set({ isLoadingOrgBilling: false })
        }
      },

      loadUserWorkspaces: async (userId?: string) => {
        try {
          // Get all workspaces the user is a member of
          const workspacesResponse = await fetch('/api/workspaces')
          if (!workspacesResponse.ok) {
            logger.error('Failed to fetch workspaces')
            return
          }

          const workspacesData = await workspacesResponse.json()
          const allUserWorkspaces = workspacesData.workspaces || []

          // Filter to only show workspaces where user has admin permissions
          const adminWorkspaces = []

          for (const workspace of allUserWorkspaces) {
            try {
              const permissionResponse = await fetch(`/api/workspaces/${workspace.id}/permissions`)
              if (permissionResponse.ok) {
                const permissionData = await permissionResponse.json()

                // Check if current user has admin permission
                // Use userId if provided, otherwise fall back to checking isOwner from workspace data
                let hasAdminAccess = false

                if (userId && permissionData.users) {
                  const currentUserPermission = permissionData.users.find(
                    (user: any) => user.id === userId || user.userId === userId
                  )
                  hasAdminAccess = currentUserPermission?.permissionType === 'admin'
                }

                // Also check if user is the workspace owner
                const isOwner = workspace.isOwner || workspace.ownerId === userId

                if (hasAdminAccess || isOwner) {
                  adminWorkspaces.push({
                    ...workspace,
                    isOwner: isOwner,
                    canInvite: true,
                  })
                }
              }
            } catch (error) {
              logger.warn(`Failed to check permissions for workspace ${workspace.id}:`, error)
            }
          }

          set({ userWorkspaces: adminWorkspaces })

          logger.info('Loaded admin workspaces for invitation', {
            total: allUserWorkspaces.length,
            adminWorkspaces: adminWorkspaces.length,
            userId: userId || 'not provided',
          })
        } catch (error) {
          logger.error('Failed to load workspaces:', error)
        }
      },

      refreshOrganization: async () => {
        if (!isBillingEnabled) {
          logger.debug('Billing disabled, skipping organization refresh')
          return
        }

        const { activeOrganization } = get()
        if (!activeOrganization?.id) return

        try {
          const fullOrgResponse = await client.organization.getFullOrganization()
          const updatedOrg = fullOrgResponse.data

          logger.info('Refreshed organization data', {
            orgId: updatedOrg?.id,
            members: updatedOrg?.members?.length ?? 0,
            invitations: updatedOrg?.invitations?.length ?? 0,
            pendingInvitations:
              updatedOrg?.invitations?.filter((inv: any) => inv.status === 'pending').length ?? 0,
          })

          set({ activeOrganization: updatedOrg })

          // Also refresh subscription data
          if (updatedOrg?.id) {
            await get().loadOrganizationSubscription(updatedOrg.id)
          }
        } catch (error) {
          logger.error('Failed to refresh organization data', { error })
          set({
            error: error instanceof Error ? error.message : 'Failed to refresh organization data',
          })
        }
      },

      // Organization management
      createOrganization: async (name: string, slug: string) => {
        if (!isBillingEnabled) {
          logger.debug('Billing disabled, skipping organization creation')
          set({
            error: 'Organizations are only available when billing is enabled',
            isCreatingOrg: false,
          })
          return
        }

        set({ isCreatingOrg: true, error: null })

        try {
          logger.info('Creating team organization', { name, slug })

          const result = await client.organization.create({ name, slug })
          if (!result.data?.id) {
            throw new Error('Failed to create organization')
          }

          const orgId = result.data.id
          logger.info('Organization created', { orgId })

          // Set as active organization
          await client.organization.setActive({ organizationId: orgId })

          // Handle subscription transfer if needed
          const { hasTeamPlan, hasEnterprisePlan } = get()
          if (hasTeamPlan || hasEnterprisePlan) {
            await get().transferSubscriptionToOrganization(orgId)
          }

          // Refresh data
          await get().loadData()

          set({ isCreatingOrg: false })
        } catch (error) {
          logger.error('Failed to create organization', { error })
          set({
            error: error instanceof Error ? error.message : 'Failed to create organization',
            isCreatingOrg: false,
          })
        }
      },

      setActiveOrganization: async (orgId: string) => {
        set({ isLoading: true })

        try {
          await client.organization.setActive({ organizationId: orgId })

          const activeOrgResponse = await client.organization.getFullOrganization()
          const activeOrganization = activeOrgResponse.data

          set({ activeOrganization })

          if (activeOrganization?.id) {
            await get().loadOrganizationSubscription(activeOrganization.id)
          }
        } catch (error) {
          logger.error('Failed to set active organization', { error })
          set({
            error: error instanceof Error ? error.message : 'Failed to set active organization',
          })
        } finally {
          set({ isLoading: false })
        }
      },

      updateOrganizationSettings: async () => {
        const { activeOrganization, orgFormData } = get()
        if (!activeOrganization?.id) return

        // Validate form
        if (!orgFormData.name.trim()) {
          set({ orgSettingsError: 'Organization name is required' })
          return
        }

        if (!orgFormData.slug.trim()) {
          set({ orgSettingsError: 'Organization slug is required' })
          return
        }

        // Validate slug format
        if (!validateSlug(orgFormData.slug)) {
          set({
            orgSettingsError:
              'Slug can only contain lowercase letters, numbers, hyphens, and underscores',
          })
          return
        }

        set({ isSavingOrgSettings: true, orgSettingsError: null, orgSettingsSuccess: null })

        try {
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

          set({ orgSettingsSuccess: 'Organization settings updated successfully' })

          // Refresh organization data
          await get().refreshOrganization()

          // Clear success message after 3 seconds
          setTimeout(() => {
            set({ orgSettingsSuccess: null })
          }, 3000)
        } catch (error) {
          logger.error('Failed to update organization settings', { error })
          set({
            orgSettingsError: error instanceof Error ? error.message : 'Failed to update settings',
          })
        } finally {
          set({ isSavingOrgSettings: false })
        }
      },

      // Team management
      inviteMember: async (email: string, workspaceInvitations?: WorkspaceInvitation[]) => {
        const { activeOrganization, subscriptionData } = get()
        if (!activeOrganization) return

        set({ isInviting: true, error: null, inviteSuccess: false })

        try {
          const { used: totalCount } = calculateSeatUsage(activeOrganization)
          const seatLimit = subscriptionData?.seats || 0

          if (totalCount >= seatLimit) {
            throw new Error(
              `You've reached your team seat limit of ${seatLimit}. Please upgrade your plan for more seats.`
            )
          }

          if (!validateEmail(email)) {
            throw new Error('Please enter a valid email address')
          }

          logger.info('Sending invitation to member', {
            email,
            organizationId: activeOrganization.id,
            workspaceInvitations,
          })

          // Use direct API call with workspace invitations if selected
          if (workspaceInvitations && workspaceInvitations.length > 0) {
            const response = await fetch(
              `/api/organizations/${activeOrganization.id}/invitations?batch=true`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  email,
                  role: 'member',
                  workspaceInvitations,
                }),
              }
            )

            if (!response.ok) {
              const errorData = await response.json()
              throw new Error(errorData.error || 'Failed to send invitation')
            }
          } else {
            // Use existing client method for organization-only invitations
            const inviteResult = await client.organization.inviteMember({
              email,
              role: 'member',
              organizationId: activeOrganization.id,
            })

            if (inviteResult.error) {
              throw new Error(inviteResult.error.message || 'Failed to send invitation')
            }
          }

          set({ inviteSuccess: true })
          await get().refreshOrganization()
        } catch (error) {
          logger.error('Error inviting member', { error })
          set({ error: error instanceof Error ? error.message : 'Failed to invite member' })
        } finally {
          set({ isInviting: false })
        }
      },

      removeMember: async (memberId: string, shouldReduceSeats = false) => {
        const { activeOrganization, subscriptionData } = get()
        if (!activeOrganization) return

        set({ isLoading: true })

        try {
          await client.organization.removeMember({
            memberIdOrEmail: memberId,
            organizationId: activeOrganization.id,
          })

          // If the user opted to reduce seats as well
          if (shouldReduceSeats && subscriptionData) {
            const currentSeats = subscriptionData.seats || 0
            if (currentSeats > 1) {
              await get().reduceSeats(currentSeats - 1)
            }
          }

          await get().refreshOrganization()
        } catch (error) {
          logger.error('Failed to remove member', { error })
          set({ error: error instanceof Error ? error.message : 'Failed to remove member' })
        } finally {
          set({ isLoading: false })
        }
      },

      cancelInvitation: async (invitationId: string) => {
        const { activeOrganization } = get()
        if (!activeOrganization) return

        set({ isLoading: true })

        try {
          await client.organization.cancelInvitation({ invitationId })
          await get().refreshOrganization()
        } catch (error) {
          logger.error('Failed to cancel invitation', { error })
          set({ error: error instanceof Error ? error.message : 'Failed to cancel invitation' })
        } finally {
          set({ isLoading: false })
        }
      },

      // Seat management
      addSeats: async (newSeatCount: number) => {
        const { activeOrganization, subscriptionData } = get()
        if (!activeOrganization || !subscriptionData) return

        set({ isLoading: true, error: null })

        try {
          const { error } = await client.subscription.upgrade({
            plan: 'team',
            referenceId: activeOrganization.id,
            subscriptionId: subscriptionData.id,
            seats: newSeatCount,
            successUrl: window.location.href,
            cancelUrl: window.location.href,
          })

          if (error) {
            throw new Error(error.message || 'Failed to update seats')
          }

          await get().refreshOrganization()
        } catch (error) {
          logger.error('Failed to add seats', { error })
          set({ error: error instanceof Error ? error.message : 'Failed to update seats' })
        } finally {
          set({ isLoading: false })
        }
      },

      reduceSeats: async (newSeatCount: number) => {
        const { activeOrganization, subscriptionData } = get()
        if (!activeOrganization || !subscriptionData) return

        // Don't allow enterprise users to modify seats
        if (checkEnterprisePlan(subscriptionData)) {
          set({ error: 'Enterprise plan seats can only be modified by contacting support' })
          return
        }

        if (newSeatCount <= 0) {
          set({ error: 'Cannot reduce seats below 1' })
          return
        }

        const { used: totalCount } = calculateSeatUsage(activeOrganization)
        if (totalCount > newSeatCount) {
          set({
            error: `You have ${totalCount} active members/invitations. Please remove members or cancel invitations before reducing seats.`,
          })
          return
        }

        set({ isLoading: true, error: null })

        try {
          const { error } = await client.subscription.upgrade({
            plan: 'team',
            referenceId: activeOrganization.id,
            subscriptionId: subscriptionData.id,
            seats: newSeatCount,
            successUrl: window.location.href,
            cancelUrl: window.location.href,
          })

          if (error) {
            throw new Error(error.message || 'Failed to reduce seats')
          }

          await get().refreshOrganization()
        } catch (error) {
          logger.error('Failed to reduce seats', { error })
          set({ error: error instanceof Error ? error.message : 'Failed to reduce seats' })
        } finally {
          set({ isLoading: false })
        }
      },

      // Private helper method for subscription transfer
      transferSubscriptionToOrganization: async (orgId: string) => {
        const { hasTeamPlan, hasEnterprisePlan } = get()

        try {
          const userSubResponse = await client.subscription.list()
          let teamSubscription: Subscription | null =
            (userSubResponse.data?.find(
              (sub) => (sub.plan === 'team' || sub.plan === 'enterprise') && sub.status === 'active'
            ) as Subscription | undefined) || null

          // If no subscription found through client API but user has enterprise plan
          if (!teamSubscription && hasEnterprisePlan) {
            const billingResponse = await fetch('/api/billing?context=user')
            if (billingResponse.ok) {
              const billingData = await billingResponse.json()
              if (billingData.success && billingData.data.isEnterprise && billingData.data.status) {
                teamSubscription = {
                  id: `subscription_${Date.now()}`,
                  plan: billingData.data.plan,
                  status: billingData.data.status,
                  seats: billingData.data.seats,
                  referenceId: billingData.data.organizationId || 'unknown',
                }
              }
            }
          }

          if (teamSubscription) {
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
                errorMessage = errorText || errorMessage
              }

              throw new Error(errorMessage)
            }
          }
        } catch (error) {
          logger.error('Subscription transfer failed', { error })
          throw error
        }
      },

      // Computed getters (keep only those that are used)
      getUserRole: (userEmail?: string) => {
        const { activeOrganization } = get()
        if (!userEmail || !activeOrganization?.members) {
          return 'member'
        }
        const currentMember = activeOrganization.members.find((m) => m.user?.email === userEmail)
        return currentMember?.role ?? 'member'
      },

      isAdminOrOwner: (userEmail?: string) => {
        const role = get().getUserRole(userEmail)
        return role === 'owner' || role === 'admin'
      },

      getUsedSeats: () => {
        const { activeOrganization } = get()
        return calculateSeatUsage(activeOrganization)
      },

      // Form handlers
      setOrgFormData: (data) => {
        set((state) => ({
          orgFormData: { ...state.orgFormData, ...data },
        }))

        // Auto-generate slug from name if name is being set
        if (data.name) {
          const autoSlug = generateSlug(data.name)
          set((state) => ({
            orgFormData: { ...state.orgFormData, slug: autoSlug },
          }))
        }
      },

      // Utility methods
      clearError: () => {
        set({ error: null })
      },

      clearSuccessMessages: () => {
        set({ inviteSuccess: false, orgSettingsSuccess: null })
      },

      reset: () => {
        set({
          organizations: [],
          activeOrganization: null,
          subscriptionData: null,
          userWorkspaces: [],
          organizationBillingData: null,
          orgFormData: {
            name: '',
            slug: '',
            logo: '',
          },
          isLoading: false,
          isLoadingSubscription: false,
          isLoadingOrgBilling: false,
          isCreatingOrg: false,
          isInviting: false,
          isSavingOrgSettings: false,
          error: null,
          orgSettingsError: null,
          inviteSuccess: false,
          orgSettingsSuccess: null,
          lastFetched: null,
          lastSubscriptionFetched: null,
          lastOrgBillingFetched: null,
          hasTeamPlan: false,
          hasEnterprisePlan: false,
        })
      },
    }),
    { name: 'organization-store' }
  )
)

// Auto-load organization data when store is first accessed
if (typeof window !== 'undefined') {
  useOrganizationStore.getState().loadData()
}
