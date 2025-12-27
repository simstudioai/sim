'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { useQueryClient } from '@tanstack/react-query'
import { Files, KeySquare, LogIn, Settings, User, Users, Wrench } from 'lucide-react'
import {
  Card,
  Connections,
  FolderCode,
  HexSimple,
  Key,
  SModal,
  SModalContent,
  SModalMain,
  SModalMainBody,
  SModalMainHeader,
  SModalSidebar,
  SModalSidebarHeader,
  SModalSidebarItem,
  SModalSidebarSection,
  SModalSidebarSectionTitle,
} from '@/components/emcn'
import { McpIcon } from '@/components/icons'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionStatus } from '@/lib/billing/client'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/feature-flags'
import { getUserRole } from '@/lib/workspaces/organization'
import {
  ApiKeys,
  BYOK,
  Copilot,
  CustomTools,
  EnvironmentVariables,
  FileUploads,
  General,
  Integrations,
  MCP,
  SSO,
  Subscription,
  TeamManagement,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components'
import { TemplateProfile } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/template-profile/template-profile'
import { generalSettingsKeys, useGeneralSettings } from '@/hooks/queries/general-settings'
import { organizationKeys, useOrganizations } from '@/hooks/queries/organization'
import { ssoKeys, useSSOProviders } from '@/hooks/queries/sso'
import { subscriptionKeys, useSubscriptionData } from '@/hooks/queries/subscription'
import { useSettingsModalStore } from '@/stores/settings-modal/store'

const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))
const isSSOEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SettingsSection =
  | 'general'
  | 'environment'
  | 'template-profile'
  | 'integrations'
  | 'apikeys'
  | 'byok'
  | 'files'
  | 'subscription'
  | 'team'
  | 'sso'
  | 'copilot'
  | 'mcp'
  | 'custom-tools'

type NavigationSection = 'account' | 'subscription' | 'tools' | 'system'

type NavigationItem = {
  id: SettingsSection
  label: string
  icon: React.ComponentType<{ className?: string }>
  section: NavigationSection
  hideWhenBillingDisabled?: boolean
  requiresTeam?: boolean
  requiresEnterprise?: boolean
  requiresOwner?: boolean
  requiresHosted?: boolean
}

const sectionConfig: { key: NavigationSection; title: string }[] = [
  { key: 'account', title: 'Account' },
  { key: 'tools', title: 'Tools' },
  { key: 'subscription', title: 'Subscription' },
  { key: 'system', title: 'System' },
]

const allNavigationItems: NavigationItem[] = [
  { id: 'general', label: 'General', icon: Settings, section: 'account' },
  { id: 'template-profile', label: 'Template Profile', icon: User, section: 'account' },
  {
    id: 'subscription',
    label: 'Subscription',
    icon: Card,
    section: 'subscription',
    hideWhenBillingDisabled: true,
  },
  {
    id: 'team',
    label: 'Team',
    icon: Users,
    section: 'subscription',
    hideWhenBillingDisabled: true,
    requiresTeam: true,
  },
  { id: 'integrations', label: 'Integrations', icon: Connections, section: 'tools' },
  { id: 'custom-tools', label: 'Custom Tools', icon: Wrench, section: 'tools' },
  { id: 'mcp', label: 'MCPs', icon: McpIcon, section: 'tools' },
  { id: 'environment', label: 'Environment', icon: FolderCode, section: 'system' },
  { id: 'apikeys', label: 'API Keys', icon: Key, section: 'system' },
  {
    id: 'byok',
    label: 'BYOK',
    icon: KeySquare,
    section: 'system',
    requiresHosted: true,
  },
  {
    id: 'copilot',
    label: 'Copilot Keys',
    icon: HexSimple,
    section: 'system',
    requiresHosted: true,
  },
  { id: 'files', label: 'Files', icon: Files, section: 'system' },
  {
    id: 'sso',
    label: 'Single Sign-On',
    icon: LogIn,
    section: 'system',
    requiresTeam: true,
    requiresEnterprise: true,
    requiresOwner: true,
  },
]

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const { initialSection, mcpServerId, clearInitialState } = useSettingsModalStore()
  const [pendingMcpServerId, setPendingMcpServerId] = useState<string | null>(null)
  const { data: session } = useSession()
  const queryClient = useQueryClient()
  const { data: organizationsData } = useOrganizations()
  const { data: subscriptionData } = useSubscriptionData()
  const { data: ssoProvidersData, isLoading: isLoadingSSO } = useSSOProviders()

  const activeOrganization = organizationsData?.activeOrganization
  const environmentBeforeLeaveHandler = useRef<((onProceed: () => void) => void) | null>(null)
  const integrationsCloseHandler = useRef<((open: boolean) => void) | null>(null)

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

      // SSO has special logic that must be checked before requiresTeam
      if (item.id === 'sso') {
        if (isHosted) {
          return hasOrganization && hasEnterprisePlan && canManageSSO
        }
        // For self-hosted, only show SSO tab if explicitly enabled via environment variable
        if (!isSSOEnabled) return false
        // Show tab if user is the SSO provider owner, or if no providers exist yet (to allow initial setup)
        const hasProviders = (ssoProvidersData?.providers?.length ?? 0) > 0
        return !hasProviders || isSSOProviderOwner === true
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
    isSSOEnabled,
    ssoProvidersData?.providers?.length,
    isOwner,
    isAdmin,
    userRole,
    subscriptionStatus.isTeam,
    subscriptionStatus.isEnterprise,
  ])

  // Memoized callbacks to prevent infinite loops in child components
  const registerEnvironmentBeforeLeaveHandler = useCallback(
    (handler: (onProceed: () => void) => void) => {
      environmentBeforeLeaveHandler.current = handler
    },
    []
  )

  const registerIntegrationsCloseHandler = useCallback((handler: (open: boolean) => void) => {
    integrationsCloseHandler.current = handler
  }, [])

  const handleSectionChange = useCallback(
    (sectionId: SettingsSection) => {
      if (sectionId === activeSection) return

      if (activeSection === 'environment' && environmentBeforeLeaveHandler.current) {
        environmentBeforeLeaveHandler.current(() => setActiveSection(sectionId))
        return
      }

      setActiveSection(sectionId)
    },
    [activeSection]
  )

  // React Query hook automatically loads and syncs settings
  useGeneralSettings()

  // Apply initial section from store when modal opens
  useEffect(() => {
    if (open && initialSection) {
      setActiveSection(initialSection)
      if (mcpServerId) {
        setPendingMcpServerId(mcpServerId)
      }
      clearInitialState()
    }
  }, [open, initialSection, mcpServerId, clearInitialState])

  // Clear pending server ID when section changes away from MCP
  useEffect(() => {
    if (activeSection !== 'mcp') {
      setPendingMcpServerId(null)
    }
  }, [activeSection])

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
        const { client } = await import('@/lib/auth/auth-client')
        const [orgsResponse, activeOrgResponse] = await Promise.all([
          client.organization.list(),
          client.organization.getFullOrganization(),
        ])

        return {
          organizations: orgsResponse.data || [],
          activeOrganization: activeOrgResponse.data,
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

  // Handle dialog close - delegate to environment component if it's active
  const handleDialogOpenChange = (newOpen: boolean) => {
    if (!newOpen && activeSection === 'environment' && environmentBeforeLeaveHandler.current) {
      environmentBeforeLeaveHandler.current(() => onOpenChange(false))
    } else if (!newOpen && activeSection === 'integrations' && integrationsCloseHandler.current) {
      integrationsCloseHandler.current(newOpen)
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
            Configure your workspace settings, environment variables, integrations, and preferences
          </DialogPrimitive.Description>
        </VisuallyHidden.Root>

        <SModalSidebar>
          <SModalSidebarHeader>Settings</SModalSidebarHeader>
          {sectionConfig.map(({ key, title }) => {
            const sectionItems = navigationItems.filter((item) => item.section === key)
            if (sectionItems.length === 0) return null

            return (
              <SModalSidebarSection key={key}>
                <SModalSidebarSectionTitle>{title}</SModalSidebarSectionTitle>
                {sectionItems.map((item) => (
                  <SModalSidebarItem
                    key={item.id}
                    active={activeSection === item.id}
                    icon={<item.icon />}
                    onMouseEnter={() => handlePrefetch(item.id)}
                    onClick={() => handleSectionChange(item.id)}
                    data-section={item.id}
                  >
                    {item.label}
                  </SModalSidebarItem>
                ))}
              </SModalSidebarSection>
            )
          })}
        </SModalSidebar>

        <SModalMain>
          <SModalMainHeader>
            {navigationItems.find((item) => item.id === activeSection)?.label || activeSection}
          </SModalMainHeader>
          <SModalMainBody>
            {activeSection === 'general' && <General onOpenChange={onOpenChange} />}
            {activeSection === 'environment' && (
              <EnvironmentVariables
                registerBeforeLeaveHandler={registerEnvironmentBeforeLeaveHandler}
              />
            )}
            {activeSection === 'template-profile' && <TemplateProfile />}
            {activeSection === 'integrations' && (
              <Integrations
                onOpenChange={onOpenChange}
                registerCloseHandler={registerIntegrationsCloseHandler}
              />
            )}
            {activeSection === 'apikeys' && <ApiKeys onOpenChange={onOpenChange} />}
            {activeSection === 'files' && <FileUploads />}
            {isBillingEnabled && activeSection === 'subscription' && <Subscription />}
            {isBillingEnabled && activeSection === 'team' && <TeamManagement />}
            {activeSection === 'sso' && <SSO />}
            {activeSection === 'byok' && <BYOK />}
            {activeSection === 'copilot' && <Copilot />}
            {activeSection === 'mcp' && <MCP initialServerId={pendingMcpServerId} />}
            {activeSection === 'custom-tools' && <CustomTools />}
          </SModalMainBody>
        </SModalMain>
      </SModalContent>
    </SModal>
  )
}
