'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
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
  Users,
  Waypoints,
  Wrench,
} from 'lucide-react'
import {
  SModal,
  SModalContent,
  SModalMain,
  SModalMainBody,
  SModalMainHeader,
  SModalSidebar,
  SModalSidebarHeader,
  SModalSidebarItem,
  SModalSidebarSection,
} from '@/components/emcn'
import { useSession } from '@/lib/auth-client'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserRole } from '@/lib/organization/helpers'
import { getSubscriptionStatus } from '@/lib/subscription/helpers'
import {
  ApiKeys,
  Copilot,
  Credentials,
  CustomTools,
  EnvironmentVariables,
  FileUploads,
  General,
  MCP,
  SSO,
  Subscription,
  TeamManagement,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components-new/settings-modal/components'
import { CreatorProfile } from '@/app/workspace/[workspaceId]/w/components/sidebar/components-new/settings-modal/components/creator-profile/creator-profile'
import { generalSettingsKeys, useGeneralSettings } from '@/hooks/queries/general-settings'
import { organizationKeys, useOrganizations } from '@/hooks/queries/organization'
import { ssoKeys, useSSOProviders } from '@/hooks/queries/sso'
import { subscriptionKeys, useSubscriptionData } from '@/hooks/queries/subscription'

const logger = createLogger('SettingsModal')

// TODO: Remove this
// const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))
const isBillingEnabled = true

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SettingsSection =
  | 'general'
  | 'environment'
  | 'creator-profile'
  | 'credentials'
  | 'apikeys'
  | 'files'
  | 'subscription'
  | 'team'
  | 'sso'
  | 'copilot'
  | 'mcp'
  | 'custom-tools'

type NavigationItem = {
  id: SettingsSection
  label: string
  icon: React.ComponentType<{ className?: string }>
  hideWhenBillingDisabled?: boolean
  requiresTeam?: boolean
  requiresEnterprise?: boolean
  requiresOwner?: boolean
  requiresHosted?: boolean
}

const allNavigationItems: NavigationItem[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'credentials', label: 'Integrations', icon: Waypoints },
  { id: 'mcp', label: 'MCP Servers', icon: Server },
  { id: 'custom-tools', label: 'Custom Tools', icon: Wrench },
  { id: 'environment', label: 'Environment', icon: FileCode },
  { id: 'creator-profile', label: 'Creator Profile', icon: Palette },
  { id: 'apikeys', label: 'API Keys', icon: Key },
  { id: 'files', label: 'Files', icon: Files },
  { id: 'copilot', label: 'Copilot', icon: Bot, requiresHosted: true },
  { id: 'subscription', label: 'Subscription', icon: CreditCard, hideWhenBillingDisabled: true },
  { id: 'team', label: 'Team', icon: Users, hideWhenBillingDisabled: true, requiresTeam: true },
  {
    id: 'sso',
    label: 'Single Sign-On',
    icon: LogIn,
    requiresTeam: true,
    requiresEnterprise: true,
    requiresOwner: true,
  },
]

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const { data: session } = useSession()
  const queryClient = useQueryClient()
  const { data: organizationsData } = useOrganizations()
  const { data: subscriptionData } = useSubscriptionData()
  const { data: ssoProvidersData, isLoading: isLoadingSSO } = useSSOProviders()

  const activeOrganization = organizationsData?.activeOrganization
  const environmentCloseHandler = useRef<((open: boolean) => void) | null>(null)
  const credentialsCloseHandler = useRef<((open: boolean) => void) | null>(null)

  const userEmail = session?.user?.email
  const userId = session?.user?.id
  const userRole = getUserRole(activeOrganization, userEmail)
  const isOwner = userRole === 'owner'
  const isAdmin = userRole === 'admin'
  const canManageSSO = isOwner || isAdmin
  const subscriptionStatus = getSubscriptionStatus(subscriptionData?.data)
  const hasEnterprisePlan = subscriptionStatus.isEnterprise
  const hasOrganization = !!activeOrganization?.id

  // Memoize SSO provider ownership check
  const isSSOProviderOwner = useMemo(() => {
    if (isHosted) return null
    if (!userId || isLoadingSSO) return null
    return ssoProvidersData?.providers?.some((p: any) => p.userId === userId) || false
  }, [userId, ssoProvidersData?.providers, isLoadingSSO])

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
        return isSSOProviderOwner === true
      }

      if (item.requiresOwner && !isOwner) {
        return false
      }

      return true
    })
  }, [
    hasOrganization,
    hasEnterprisePlan,
    canManageSSO,
    isSSOProviderOwner,
    isOwner,
    isAdmin,
    userRole,
    subscriptionStatus.isTeam,
    subscriptionStatus.isEnterprise,
  ])

  // Memoized callbacks to prevent infinite loops in child components
  const registerEnvironmentCloseHandler = useCallback((handler: (open: boolean) => void) => {
    environmentCloseHandler.current = handler
  }, [])

  const registerCredentialsCloseHandler = useCallback((handler: (open: boolean) => void) => {
    credentialsCloseHandler.current = handler
  }, [])

  // React Query hook automatically loads and syncs settings
  useGeneralSettings()

  useEffect(() => {
    const handleOpenSettings = (event: CustomEvent<{ tab: SettingsSection }>) => {
      setActiveSection(event.detail.tab)
      onOpenChange(true)
    }

    const handleCloseSettings = () => {
      onOpenChange(false)
    }

    window.addEventListener('open-settings', handleOpenSettings as EventListener)
    window.addEventListener('close-settings', handleCloseSettings as EventListener)

    return () => {
      window.removeEventListener('open-settings', handleOpenSettings as EventListener)
      window.removeEventListener('close-settings', handleCloseSettings as EventListener)
    }
  }, [onOpenChange])

  // Redirect away from billing tabs if billing is disabled
  useEffect(() => {
    if (!isBillingEnabled && (activeSection === 'subscription' || activeSection === 'team')) {
      setActiveSection('general')
    }
  }, [activeSection])

  // Prefetch functions for React Query
  const prefetchGeneral = () => {
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
          showTrainingControls: data.showTrainingControls ?? false,
          superUserModeEnabled: data.superUserModeEnabled ?? true,
          theme: data.theme || 'system',
          telemetryEnabled: data.telemetryEnabled ?? true,
          billingUsageNotificationsEnabled: data.billingUsageNotificationsEnabled ?? true,
        }
      },
      staleTime: 60 * 60 * 1000,
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
      staleTime: 5 * 60 * 1000,
    })
  }

  const handlePrefetch = (id: SettingsSection) => {
    switch (id) {
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
  }

  const handleHomepageClick = () => {
    window.location.href = '/?from=settings'
  }

  // Handle dialog close - delegate to environment component if it's active
  const handleDialogOpenChange = (newOpen: boolean) => {
    if (!newOpen && activeSection === 'environment' && environmentCloseHandler.current) {
      environmentCloseHandler.current(newOpen)
    } else if (!newOpen && activeSection === 'credentials' && credentialsCloseHandler.current) {
      credentialsCloseHandler.current(newOpen)
    } else {
      onOpenChange(newOpen)
    }
  }

  return (
    <SModal open={open} onOpenChange={handleDialogOpenChange}>
      <SModalContent>
        <VisuallyHidden.Root>
          <DialogPrimitive.Title>Settings</DialogPrimitive.Title>
        </VisuallyHidden.Root>
        <VisuallyHidden.Root>
          <DialogPrimitive.Description>
            Configure your workspace settings, environment variables, credentials, and preferences
          </DialogPrimitive.Description>
        </VisuallyHidden.Root>

        <SModalSidebar>
          <SModalSidebarHeader>Settings</SModalSidebarHeader>
          <SModalSidebarSection>
            {navigationItems.map((item) => (
              <SModalSidebarItem
                key={item.id}
                active={activeSection === item.id}
                icon={<item.icon />}
                onMouseEnter={() => handlePrefetch(item.id)}
                onClick={() => setActiveSection(item.id)}
                data-section={item.id}
              >
                {item.label}
              </SModalSidebarItem>
            ))}

            {isHosted && (
              <SModalSidebarItem icon={<Home />} onClick={handleHomepageClick}>
                Homepage
              </SModalSidebarItem>
            )}
          </SModalSidebarSection>
        </SModalSidebar>

        <SModalMain>
          <SModalMainHeader>
            {navigationItems.find((item) => item.id === activeSection)?.label || activeSection}
          </SModalMainHeader>
          <SModalMainBody>
            {activeSection === 'general' && <General onOpenChange={onOpenChange} />}
            {activeSection === 'environment' && (
              <EnvironmentVariables
                onOpenChange={onOpenChange}
                registerCloseHandler={registerEnvironmentCloseHandler}
              />
            )}
            {activeSection === 'creator-profile' && <CreatorProfile />}
            {activeSection === 'credentials' && (
              <Credentials
                onOpenChange={onOpenChange}
                registerCloseHandler={registerCredentialsCloseHandler}
              />
            )}
            {activeSection === 'apikeys' && <ApiKeys onOpenChange={onOpenChange} />}
            {activeSection === 'files' && <FileUploads />}
            {isBillingEnabled && activeSection === 'subscription' && (
              <Subscription onOpenChange={onOpenChange} />
            )}
            {isBillingEnabled && activeSection === 'team' && <TeamManagement />}
            {activeSection === 'sso' && <SSO />}
            {activeSection === 'copilot' && <Copilot />}
            {activeSection === 'mcp' && <MCP />}
            {activeSection === 'custom-tools' && <CustomTools />}
          </SModalMainBody>
        </SModalMain>
      </SModalContent>
    </SModal>
  )
}
