import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  CreditCard,
  FileCode,
  Files,
  Home,
  Key,
  LogIn,
  Palette,
  Server,
  Settings,
  Shield,
  User,
  Users,
  Waypoints,
  Wrench,
} from 'lucide-react'
import { useSession } from '@/lib/auth-client'
import { getEnv, isTruthy } from '@/lib/env'
import { isHosted } from '@/lib/environment'
import { getUserRole } from '@/lib/organization/helpers'
import { getSubscriptionStatus } from '@/lib/subscription/helpers'
import { cn } from '@/lib/utils'
import { generalSettingsKeys } from '@/hooks/queries/general-settings'
import { organizationKeys, useOrganizations } from '@/hooks/queries/organization'
import { ssoKeys, useSSOProviders } from '@/hooks/queries/sso'
import { subscriptionKeys, useSubscriptionData } from '@/hooks/queries/subscription'

const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))

interface SettingsNavigationProps {
  activeSection: string
  onSectionChange: (
    section:
      | 'general'
      | 'environment'
      | 'account'
      | 'creator-profile'
      | 'credentials'
      | 'apikeys'
      | 'files'
      | 'subscription'
      | 'team'
      | 'sso'
      | 'privacy'
      | 'copilot'
      | 'mcp'
      | 'custom-tools'
  ) => void
  hasOrganization: boolean
}

type NavigationItem = {
  id:
    | 'general'
    | 'environment'
    | 'account'
    | 'creator-profile'
    | 'credentials'
    | 'apikeys'
    | 'files'
    | 'subscription'
    | 'team'
    | 'sso'
    | 'copilot'
    | 'privacy'
    | 'mcp'
    | 'custom-tools'
  label: string
  icon: React.ComponentType<{ className?: string }>
  hideWhenBillingDisabled?: boolean
  requiresTeam?: boolean
  requiresEnterprise?: boolean
  requiresOwner?: boolean
  requiresHosted?: boolean
}

const allNavigationItems: NavigationItem[] = [
  {
    id: 'general',
    label: 'General',
    icon: Settings,
  },
  {
    id: 'credentials',
    label: 'Integrations',
    icon: Waypoints,
  },
  {
    id: 'mcp',
    label: 'MCP Servers',
    icon: Server,
  },
  {
    id: 'custom-tools',
    label: 'Custom Tools',
    icon: Wrench,
  },
  {
    id: 'environment',
    label: 'Environment',
    icon: FileCode,
  },
  {
    id: 'account',
    label: 'Account',
    icon: User,
  },
  {
    id: 'creator-profile',
    label: 'Creator Profile',
    icon: Palette,
  },
  {
    id: 'apikeys',
    label: 'API Keys',
    icon: Key,
  },
  {
    id: 'files',
    label: 'Files',
    icon: Files,
  },
  {
    id: 'copilot',
    label: 'Copilot',
    icon: Bot,
    requiresHosted: true,
  },
  {
    id: 'privacy',
    label: 'Privacy',
    icon: Shield,
  },
  {
    id: 'subscription',
    label: 'Subscription',
    icon: CreditCard,
    hideWhenBillingDisabled: true,
  },
  {
    id: 'team',
    label: 'Team',
    icon: Users,
    hideWhenBillingDisabled: true,
    requiresTeam: true,
  },
  {
    id: 'sso',
    label: 'Single Sign-On',
    icon: LogIn,
    requiresTeam: true,
    requiresEnterprise: true,
    requiresOwner: true,
  },
]

export function SettingsNavigation({
  activeSection,
  onSectionChange,
  hasOrganization,
}: SettingsNavigationProps) {
  const { data: session } = useSession()
  const queryClient = useQueryClient()
  const { data: orgsData } = useOrganizations()
  const { data: subscriptionData } = useSubscriptionData()
  const activeOrg = orgsData?.activeOrganization
  const userEmail = session?.user?.email
  const userId = session?.user?.id
  const userRole = getUserRole(activeOrg, userEmail)
  const isOwner = userRole === 'owner'
  const isAdmin = userRole === 'admin'
  const canManageSSO = isOwner || isAdmin
  const subscriptionStatus = getSubscriptionStatus(subscriptionData?.data)
  const hasEnterprisePlan = subscriptionStatus.isEnterprise

  // Use React Query to check SSO provider ownership (with proper caching)
  // Only fetch if not hosted (hosted uses billing/org checks)
  const { data: ssoProvidersData, isLoading: isLoadingSSO } = useSSOProviders()

  // Memoize SSO provider ownership check
  const isSSOProviderOwner = useMemo(() => {
    if (isHosted) return null
    if (!userId || isLoadingSSO) return null
    return ssoProvidersData?.providers?.some((p: any) => p.userId === userId) || false
  }, [userId, isHosted, ssoProvidersData?.providers, isLoadingSSO])

  // Memoize navigation items to avoid filtering on every render
  const navigationItems = useMemo(() => {
    return allNavigationItems.filter((item) => {
      if (item.hideWhenBillingDisabled && !isBillingEnabled) {
        return false
      }

      if (item.requiresTeam) {
        const isMember = userRole === 'member' || isAdmin
        const hasTeamPlan = subscriptionStatus.isTeam || subscriptionStatus.isEnterprise

        if (isMember) return true
        if (isOwner && hasTeamPlan) return true

        return false
      }

      if (item.requiresEnterprise && !hasEnterprisePlan) {
        return false
      }

      if (item.requiresHosted && !isHosted) {
        return false
      }

      if (item.id === 'sso') {
        if (isHosted) {
          return hasOrganization && hasEnterprisePlan && canManageSSO
        }
        // For non-hosted, only show if we know the ownership status
        return isSSOProviderOwner === true
      }

      if (item.requiresOwner && !isOwner) {
        return false
      }

      return true
    })
  }, [hasOrganization, hasEnterprisePlan, canManageSSO, isSSOProviderOwner, isOwner])

  // Prefetch functions for React Query
  const prefetchGeneral = () => {
    // Prefetch general settings using React Query
    queryClient.prefetchQuery({
      queryKey: generalSettingsKeys.settings(),
      queryFn: async () => {
        const response = await fetch('/api/users/me/settings')
        if (!response.ok) {
          throw new Error('Failed to fetch general settings')
        }
        const { data } = await response.json()
        return {
          autoConnect: data.autoConnect ?? true,
          autoPan: data.autoPan ?? true,
          consoleExpandedByDefault: data.consoleExpandedByDefault ?? true,
          showFloatingControls: data.showFloatingControls ?? true,
          showTrainingControls: data.showTrainingControls ?? false,
          superUserModeEnabled: data.superUserModeEnabled ?? true,
          theme: data.theme || 'system',
          telemetryEnabled: data.telemetryEnabled ?? true,
          billingUsageNotificationsEnabled: data.billingUsageNotificationsEnabled ?? true,
        }
      },
      staleTime: 60 * 60 * 1000, // 1 hour
    })
  }

  const prefetchSubscription = () => {
    queryClient.prefetchQuery({
      queryKey: subscriptionKeys.user(),
      queryFn: async () => {
        const response = await fetch('/api/billing?context=user')
        if (!response.ok) {
          throw new Error('Failed to fetch subscription data')
        }
        return response.json()
      },
      staleTime: 30 * 1000,
    })
  }

  const prefetchOrganization = () => {
    queryClient.prefetchQuery({
      queryKey: organizationKeys.lists(),
      queryFn: async () => {
        const { client } = await import('@/lib/auth-client')
        const [orgsResponse, activeOrgResponse, billingResponse] = await Promise.all([
          client.organization.list(),
          client.organization.getFullOrganization(),
          fetch('/api/billing?context=user').then((r) => r.json()),
        ])

        return {
          organizations: orgsResponse.data || [],
          activeOrganization: activeOrgResponse.data,
          billingData: billingResponse,
        }
      },
      staleTime: 30 * 1000,
    })
  }

  const prefetchSSO = () => {
    queryClient.prefetchQuery({
      queryKey: ssoKeys.providers(),
      queryFn: async () => {
        const response = await fetch('/api/auth/sso/providers')
        if (!response.ok) {
          throw new Error('Failed to fetch SSO providers')
        }
        return response.json()
      },
      staleTime: 5 * 60 * 1000, // 5 minutes
    })
  }

  const handleHomepageClick = () => {
    window.location.href = '/?from=settings'
  }

  return (
    <div className='h-full overflow-y-auto px-2 py-4'>
      {navigationItems.map((item) => (
        <div key={item.id} className='mb-1'>
          <button
            onMouseEnter={() => {
              switch (item.id) {
                case 'general':
                  prefetchGeneral()
                  break
                case 'subscription':
                  prefetchSubscription()
                  break
                case 'team':
                  prefetchOrganization()
                  break
                case 'sso':
                  prefetchSSO()
                  break
                default:
                  break
              }
            }}
            onClick={() => onSectionChange(item.id)}
            data-section={item.id}
            className={cn(
              'group flex h-9 w-full cursor-pointer items-center rounded-[8px] px-2 py-2 font-medium font-sans text-sm transition-colors',
              activeSection === item.id ? 'bg-muted' : 'hover:bg-muted'
            )}
          >
            <item.icon
              className={cn(
                'mr-2 h-[14px] w-[14px] flex-shrink-0 transition-colors',
                activeSection === item.id
                  ? 'text-foreground'
                  : 'text-muted-foreground group-hover:text-foreground'
              )}
            />
            <span
              className={cn(
                'min-w-0 flex-1 select-none truncate pr-1 text-left transition-colors',
                activeSection === item.id
                  ? 'text-foreground'
                  : 'text-muted-foreground group-hover:text-foreground'
              )}
            >
              {item.label}
            </span>
          </button>
        </div>
      ))}

      {/* Homepage link */}
      {isHosted && (
        <div className='mb-1'>
          <button
            onClick={handleHomepageClick}
            className='group flex h-9 w-full cursor-pointer items-center rounded-[8px] px-2 py-2 font-medium font-sans text-sm transition-colors hover:bg-muted'
          >
            <Home className='mr-2 h-[14px] w-[14px] flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground' />
            <span className='min-w-0 flex-1 select-none truncate pr-1 text-left text-muted-foreground transition-colors group-hover:text-foreground'>
              Homepage
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
