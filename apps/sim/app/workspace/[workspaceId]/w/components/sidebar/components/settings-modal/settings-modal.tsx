'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { useQueryClient } from '@tanstack/react-query'
import {
  Bug,
  Files,
  KeySquare,
  LogIn,
  Mail,
  Server,
  Settings,
  ShieldCheck,
  User,
  Users,
  Wrench,
} from 'lucide-react'
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
import { AgentSkillsIcon, McpIcon } from '@/components/icons'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionStatus } from '@/lib/billing/client'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/feature-flags'
import { getUserRole } from '@/lib/workspaces/organization'
import {
  ApiKeys,
  BYOK,
  Copilot,
  CredentialSets,
  CustomTools,
  Debug,
  EnvironmentVariables,
  FileUploads,
  General,
  Integrations,
  MCP,
  Skills,
  Subscription,
  TeamManagement,
  WorkflowMcpServers,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components'
import { TemplateProfile } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/template-profile/template-profile'
import { AccessControl } from '@/ee/access-control/components/access-control'
import { SSO } from '@/ee/sso/components/sso-settings'
import { ssoKeys, useSSOProviders } from '@/ee/sso/hooks/sso'
import { generalSettingsKeys, useGeneralSettings } from '@/hooks/queries/general-settings'
import { organizationKeys, useOrganizations } from '@/hooks/queries/organization'
import { subscriptionKeys, useSubscriptionData } from '@/hooks/queries/subscription'
import { useSuperUserStatus } from '@/hooks/queries/user-profile'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsModalStore } from '@/stores/modals/settings/store'

const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))
const isSSOEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
const isCredentialSetsEnabled = isTruthy(getEnv('NEXT_PUBLIC_CREDENTIAL_SETS_ENABLED'))
const isAccessControlEnabled = isTruthy(getEnv('NEXT_PUBLIC_ACCESS_CONTROL_ENABLED'))

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SettingsSection =
  | 'general'
  | 'environment'
  | 'template-profile'
  | 'integrations'
  | 'credential-sets'
  | 'access-control'
  | 'apikeys'
  | 'byok'
  | 'files'
  | 'subscription'
  | 'team'
  | 'sso'
  | 'copilot'
  | 'mcp'
  | 'custom-tools'
  | 'skills'
  | 'workflow-mcp-servers'
  | 'debug'

type NavigationSection =
  | 'account'
  | 'subscription'
  | 'tools'
  | 'system'
  | 'enterprise'
  | 'superuser'

type NavigationItem = {
  id: SettingsSection
  label: string
  icon: React.ComponentType<{ className?: string }>
  section: NavigationSection
  hideWhenBillingDisabled?: boolean
  requiresTeam?: boolean
  requiresEnterprise?: boolean
  requiresHosted?: boolean
  selfHostedOverride?: boolean
  requiresSuperUser?: boolean
}

const sectionConfig: { key: NavigationSection; title: string }[] = [
  { key: 'account', title: 'Account' },
  { key: 'tools', title: 'Tools' },
  { key: 'subscription', title: 'Subscription' },
  { key: 'system', title: 'System' },
  { key: 'enterprise', title: 'Enterprise' },
  { key: 'superuser', title: 'Superuser' },
]

const allNavigationItems: NavigationItem[] = [
  { id: 'general', label: 'General', icon: Settings, section: 'account' },
  { id: 'template-profile', label: 'Template Profile', icon: User, section: 'account' },
  {
    id: 'access-control',
    label: 'Access Control',
    icon: ShieldCheck,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isAccessControlEnabled,
  },
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
    requiresHosted: true,
    requiresTeam: true,
  },
  { id: 'integrations', label: 'Integrations', icon: Connections, section: 'tools' },
  { id: 'custom-tools', label: 'Custom Tools', icon: Wrench, section: 'tools' },
  { id: 'skills', label: 'Skills', icon: AgentSkillsIcon, section: 'tools' },
  { id: 'mcp', label: 'MCP Tools', icon: McpIcon, section: 'tools' },
  { id: 'environment', label: 'Environment', icon: FolderCode, section: 'system' },
  { id: 'apikeys', label: 'API Keys', icon: Key, section: 'system' },
  { id: 'workflow-mcp-servers', label: 'MCP Servers', icon: Server, section: 'system' },
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
    id: 'credential-sets',
    label: 'Email Polling',
    icon: Mail,
    section: 'system',
    requiresHosted: true,
    selfHostedOverride: isCredentialSetsEnabled,
  },
  {
    id: 'sso',
    label: 'Single Sign-On',
    icon: LogIn,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isSSOEnabled,
  },
  {
    id: 'debug',
    label: 'Debug',
    icon: Bug,
    section: 'superuser',
    requiresSuperUser: true,
  },
]

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const { initialSection, mcpServerId, clearInitialState } = useSettingsModalStore()
  const [pendingMcpServerId, setPendingMcpServerId] = useState<string | null>(null)
  const { data: session } = useSession()
  const queryClient = useQueryClient()
  const { data: organizationsData } = useOrganizations()
  const { data: generalSettings } = useGeneralSettings()
  const { data: subscriptionData } = useSubscriptionData({ enabled: isBillingEnabled })
  const { data: ssoProvidersData, isLoading: isLoadingSSO } = useSSOProviders()
  const { data: superUserData } = useSuperUserStatus(session?.user?.id)

  const activeOrganization = organizationsData?.activeOrganization
  const { config: permissionConfig } = usePermissionConfig()
  const environmentBeforeLeaveHandler = useRef<((onProceed: () => void) => void) | null>(null)
  const integrationsCloseHandler = useRef<((open: boolean) => void) | null>(null)

  const userEmail = session?.user?.email
  const userId = session?.user?.id

  const userRole = getUserRole(activeOrganization, userEmail)
  const isOwner = userRole === 'owner'
  const isAdmin = userRole === 'admin'
  const isOrgAdminOrOwner = isOwner || isAdmin
  const subscriptionStatus = getSubscriptionStatus(subscriptionData?.data)
  const hasTeamPlan = subscriptionStatus.isTeam || subscriptionStatus.isEnterprise
  const hasEnterprisePlan = subscriptionStatus.isEnterprise
  const hasOrganization = !!activeOrganization?.id

  const isSuperUser = superUserData?.isSuperUser ?? false

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

      // Permission group-based filtering
      if (item.id === 'template-profile' && permissionConfig.hideTemplates) {
        return false
      }
      if (item.id === 'apikeys' && permissionConfig.hideApiKeysTab) {
        return false
      }
      if (item.id === 'environment' && permissionConfig.hideEnvironmentTab) {
        return false
      }
      if (item.id === 'files' && permissionConfig.hideFilesTab) {
        return false
      }
      if (item.id === 'mcp' && permissionConfig.disableMcpTools) {
        return false
      }
      if (item.id === 'custom-tools' && permissionConfig.disableCustomTools) {
        return false
      }
      if (item.id === 'skills' && permissionConfig.disableSkills) {
        return false
      }

      // Self-hosted override allows showing the item when not on hosted
      if (item.selfHostedOverride && !isHosted) {
        // SSO has special logic: only show if no providers or user owns a provider
        if (item.id === 'sso') {
          const hasProviders = (ssoProvidersData?.providers?.length ?? 0) > 0
          return !hasProviders || isSSOProviderOwner === true
        }
        return true
      }

      // requiresTeam: must have team/enterprise plan AND be org admin/owner
      if (item.requiresTeam && (!hasTeamPlan || !isOrgAdminOrOwner)) {
        return false
      }

      // requiresEnterprise: must have enterprise plan AND be org admin/owner
      if (item.requiresEnterprise && (!hasEnterprisePlan || !isOrgAdminOrOwner)) {
        return false
      }

      // requiresHosted: only show on hosted environments
      if (item.requiresHosted && !isHosted) {
        return false
      }

      // requiresSuperUser: only show if user is a superuser AND has superuser mode enabled
      const superUserModeEnabled = generalSettings?.superUserModeEnabled ?? false
      const effectiveSuperUser = isSuperUser && superUserModeEnabled
      if (item.requiresSuperUser && !effectiveSuperUser) {
        return false
      }

      return true
    })
  }, [
    hasOrganization,
    hasTeamPlan,
    hasEnterprisePlan,
    isOrgAdminOrOwner,
    isSSOProviderOwner,
    ssoProvidersData?.providers?.length,
    isOwner,
    isAdmin,
    permissionConfig,
    isSuperUser,
    generalSettings?.superUserModeEnabled,
  ])

  const effectiveActiveSection = useMemo(() => {
    if (!isBillingEnabled && (activeSection === 'subscription' || activeSection === 'team')) {
      return 'general'
    }
    return activeSection
  }, [activeSection])

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
      if (sectionId === effectiveActiveSection) return

      if (effectiveActiveSection === 'environment' && environmentBeforeLeaveHandler.current) {
        environmentBeforeLeaveHandler.current(() => setActiveSection(sectionId))
        return
      }

      setActiveSection(sectionId)
    },
    [effectiveActiveSection]
  )

  useEffect(() => {
    if (open && initialSection) {
      setActiveSection(initialSection)
      if (mcpServerId) {
        setPendingMcpServerId(mcpServerId)
      }
      clearInitialState()
    }
  }, [open, initialSection, mcpServerId, clearInitialState])

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
          theme: data.theme || 'dark',
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
    if (
      !newOpen &&
      effectiveActiveSection === 'environment' &&
      environmentBeforeLeaveHandler.current
    ) {
      environmentBeforeLeaveHandler.current(() => onOpenChange(false))
    } else if (
      !newOpen &&
      effectiveActiveSection === 'integrations' &&
      integrationsCloseHandler.current
    ) {
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
                    active={effectiveActiveSection === item.id}
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
            {navigationItems.find((item) => item.id === effectiveActiveSection)?.label ||
              effectiveActiveSection}
          </SModalMainHeader>
          <SModalMainBody>
            {effectiveActiveSection === 'general' && <General onOpenChange={onOpenChange} />}
            {effectiveActiveSection === 'environment' && (
              <EnvironmentVariables
                registerBeforeLeaveHandler={registerEnvironmentBeforeLeaveHandler}
              />
            )}
            {effectiveActiveSection === 'template-profile' && <TemplateProfile />}
            {effectiveActiveSection === 'integrations' && (
              <Integrations
                onOpenChange={onOpenChange}
                registerCloseHandler={registerIntegrationsCloseHandler}
              />
            )}
            {effectiveActiveSection === 'credential-sets' && <CredentialSets />}
            {effectiveActiveSection === 'access-control' && <AccessControl />}
            {effectiveActiveSection === 'apikeys' && <ApiKeys onOpenChange={onOpenChange} />}
            {effectiveActiveSection === 'files' && <FileUploads />}
            {isBillingEnabled && effectiveActiveSection === 'subscription' && <Subscription />}
            {isBillingEnabled && effectiveActiveSection === 'team' && <TeamManagement />}
            {effectiveActiveSection === 'sso' && <SSO />}
            {effectiveActiveSection === 'byok' && <BYOK />}
            {effectiveActiveSection === 'copilot' && <Copilot />}
            {effectiveActiveSection === 'mcp' && <MCP initialServerId={pendingMcpServerId} />}
            {effectiveActiveSection === 'custom-tools' && <CustomTools />}
            {effectiveActiveSection === 'skills' && <Skills />}
            {effectiveActiveSection === 'workflow-mcp-servers' && <WorkflowMcpServers />}
            {effectiveActiveSection === 'debug' && <Debug />}
          </SModalMainBody>
        </SModalMain>
      </SModalContent>
    </SModal>
  )
}
