export interface User {
  name?: string
  email?: string
  id?: string
}

export interface Member {
  id: string
  role: string
  user?: User
}

export interface Invitation {
  id: string
  email: string
  status: string
}

export interface Organization {
  id: string
  name: string
  slug: string
  logo?: string | null
  members?: Member[]
  invitations?: Invitation[]
  createdAt: string | Date
  [key: string]: unknown
}

export interface Subscription {
  id: string
  plan: string
  status: string
  seats?: number
  referenceId: string
  cancelAtPeriodEnd?: boolean
  periodEnd?: number | Date
  trialEnd?: number | Date
  metadata?: any
  [key: string]: unknown
}

export interface WorkspaceInvitation {
  workspaceId: string
  permission: string
}

export interface Workspace {
  id: string
  name: string
  ownerId: string
  isOwner: boolean
  canInvite: boolean
}

export interface OrganizationFormData {
  name: string
  slug: string
  logo: string
}

// Organization billing and usage types
export interface MemberUsageData {
  userId: string
  userName: string
  userEmail: string
  currentUsage: number
  usageLimit: number
  percentUsed: number
  isOverLimit: boolean
  role: string
  joinedAt: string
  lastActive: string | null
}

export interface OrganizationBillingData {
  organizationId: string
  organizationName: string
  subscriptionPlan: string
  subscriptionStatus: string
  totalSeats: number
  usedSeats: number
  totalCurrentUsage: number
  totalUsageLimit: number
  averageUsagePerMember: number
  billingPeriodStart: string | null
  billingPeriodEnd: string | null
  members?: MemberUsageData[]
  userRole?: string
}

export interface OrganizationState {
  // Core organization data
  organizations: Organization[]
  activeOrganization: Organization | null

  // Team management
  subscriptionData: Subscription | null
  userWorkspaces: Workspace[]

  // Organization billing and usage
  organizationBillingData: OrganizationBillingData | null

  // Organization settings
  orgFormData: OrganizationFormData

  // Loading states
  isLoading: boolean
  isLoadingSubscription: boolean
  isLoadingOrgBilling: boolean
  isCreatingOrg: boolean
  isInviting: boolean
  isSavingOrgSettings: boolean

  // Error states
  error: string | null
  orgSettingsError: string | null

  // Success states
  inviteSuccess: boolean
  orgSettingsSuccess: string | null

  // Cache timestamps
  lastFetched: number | null
  lastSubscriptionFetched: number | null
  lastOrgBillingFetched: number | null

  // User permissions
  hasTeamPlan: boolean
  hasEnterprisePlan: boolean
}

export interface OrganizationStore extends OrganizationState {
  loadData: () => Promise<void>
  loadOrganizationSubscription: (orgId: string) => Promise<void>
  loadOrganizationBillingData: (organizationId: string) => Promise<void>
  loadUserWorkspaces: (userId?: string) => Promise<void>
  refreshOrganization: () => Promise<void>

  // Organization management
  createOrganization: (name: string, slug: string) => Promise<void>
  setActiveOrganization: (orgId: string) => Promise<void>
  updateOrganizationSettings: () => Promise<void>

  // Team management
  inviteMember: (email: string, workspaceInvitations?: WorkspaceInvitation[]) => Promise<void>
  removeMember: (memberId: string, shouldReduceSeats?: boolean) => Promise<void>
  cancelInvitation: (invitationId: string) => Promise<void>
  updateMemberUsageLimit: (
    userId: string,
    organizationId: string,
    newLimit: number
  ) => Promise<{ success: boolean; error?: string }>

  // Seat management
  addSeats: (newSeatCount: number) => Promise<void>
  reduceSeats: (newSeatCount: number) => Promise<void>

  transferSubscriptionToOrganization: (orgId: string) => Promise<void>

  getUserRole: (userEmail?: string) => string
  isAdminOrOwner: (userEmail?: string) => boolean
  getUsedSeats: () => { used: number; members: number; pending: number }

  setOrgFormData: (data: Partial<OrganizationFormData>) => void

  clearError: () => void
  clearSuccessMessages: () => void
}
