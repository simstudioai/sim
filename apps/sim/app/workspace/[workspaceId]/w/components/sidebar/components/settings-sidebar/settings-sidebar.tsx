'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, usePathname, useRouter } from 'next/navigation'
import {
  Button,
  ChevronDown,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
} from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionAccessState } from '@/lib/billing/client'
import { isHosted } from '@/lib/core/config/feature-flags'
import { cn } from '@/lib/core/utils/cn'
import { getUserRole } from '@/lib/workspaces/organization'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import {
  allNavigationItems,
  isBillingEnabled,
  sectionConfig,
} from '@/app/workspace/[workspaceId]/settings/navigation'
import { SidebarTooltip } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'
import { useSSOProviders } from '@/ee/sso/hooks/sso'
import { prefetchWorkspaceCredentials } from '@/hooks/queries/credentials'
import { prefetchGeneralSettings, useGeneralSettings } from '@/hooks/queries/general-settings'
import { useOrganizations } from '@/hooks/queries/organization'
import { prefetchSubscriptionData, useSubscriptionData } from '@/hooks/queries/subscription'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const SKELETON_SECTIONS = sectionConfig
  .map(({ key }) =>
    Math.min(
      allNavigationItems.filter(
        (item) =>
          item.section === key &&
          !(item.hideWhenBillingDisabled && !isBillingEnabled) &&
          !item.requiresTeam &&
          !item.requiresEnterprise &&
          !item.requiresSuperUser &&
          !item.requiresAdminRole &&
          item.id !== 'template-profile'
      ).length,
      3
    )
  )
  .filter((count) => count > 0)

interface SettingsSidebarProps {
  isCollapsed?: boolean
  showCollapsedTooltips?: boolean
}

export function SettingsSidebar({
  isCollapsed = false,
  showCollapsedTooltips = false,
}: SettingsSidebarProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const pathname = usePathname()
  const router = useRouter()

  const queryClient = useQueryClient()

  const requestNavigation = useSettingsDirtyStore((s) => s.requestNavigation)
  const confirmNavigation = useSettingsDirtyStore((s) => s.confirmNavigation)
  const cancelNavigation = useSettingsDirtyStore((s) => s.cancelNavigation)
  const isDirty = useSettingsDirtyStore((s) => s.isDirty)
  const [showDiscardDialog, setShowDiscardDialog] = useState(false)

  const { data: session, isPending: sessionLoading } = useSession()
  const { data: organizationsData, isLoading: orgsLoading } = useOrganizations()
  const { data: generalSettings } = useGeneralSettings()
  const { data: subscriptionData, isLoading: subscriptionLoading } = useSubscriptionData({
    enabled: isBillingEnabled,
    staleTime: 5 * 60 * 1000,
  })
  const { data: ssoProvidersData, isLoading: isLoadingSSO } = useSSOProviders({
    enabled: !isHosted,
  })

  const activeOrganization = organizationsData?.activeOrganization
  const { config: permissionConfig, isLoading: permissionLoading } = usePermissionConfig()

  const userEmail = session?.user?.email
  const userId = session?.user?.id

  const userRole = getUserRole(activeOrganization, userEmail)
  const isOwner = userRole === 'owner'
  const isAdmin = userRole === 'admin'
  const isOrgAdminOrOwner = isOwner || isAdmin
  const subscriptionAccess = getSubscriptionAccessState(subscriptionData?.data)
  const hasTeamPlan = subscriptionAccess.hasUsableTeamAccess
  const hasEnterprisePlan = subscriptionAccess.hasUsableEnterpriseAccess

  const isSuperUser = session?.user?.role === 'admin'

  const isSSOProviderOwner = useMemo(() => {
    if (isHosted) return null
    if (!userId || isLoadingSSO) return null
    return (
      ssoProvidersData?.providers?.some((p: { userId?: string }) => p.userId === userId) || false
    )
  }, [userId, ssoProvidersData?.providers, isLoadingSSO])

  const navigationItems = useMemo(() => {
    return allNavigationItems.filter((item) => {
      if (item.hideWhenBillingDisabled && !isBillingEnabled) {
        return false
      }

      if (item.id === 'template-profile') {
        return false
      }
      if (item.id === 'integrations' && permissionConfig.hideIntegrationsTab) {
        return false
      }
      if (item.id === 'secrets' && permissionConfig.hideSecretsTab) {
        return false
      }
      if (item.id === 'apikeys' && permissionConfig.hideApiKeysTab) {
        return false
      }
      if (item.id === 'inbox' && permissionConfig.hideInboxTab) {
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

      if (item.selfHostedOverride && !isHosted) {
        if (item.id === 'sso') {
          const hasProviders = (ssoProvidersData?.providers?.length ?? 0) > 0
          return !hasProviders || isSSOProviderOwner === true
        }
        return true
      }

      if (item.requiresTeam && (!hasTeamPlan || !isOrgAdminOrOwner)) {
        return false
      }

      if (
        item.requiresEnterprise &&
        (!hasEnterprisePlan || !isOrgAdminOrOwner) &&
        !item.showWhenLocked
      ) {
        return false
      }

      if (item.requiresMax && !subscriptionAccess.hasUsableMaxAccess && !item.showWhenLocked) {
        return false
      }

      if (item.requiresHosted && !isHosted) {
        return false
      }

      const superUserModeEnabled = generalSettings?.superUserModeEnabled ?? false
      const effectiveSuperUser = isSuperUser && superUserModeEnabled
      if (item.requiresSuperUser && !effectiveSuperUser) {
        return false
      }

      if (item.requiresAdminRole && !isSuperUser) {
        return false
      }

      return true
    })
  }, [
    hasTeamPlan,
    hasEnterprisePlan,
    subscriptionAccess.hasUsableMaxAccess,
    isOrgAdminOrOwner,
    isSSOProviderOwner,
    ssoProvidersData?.providers?.length,
    permissionConfig,
    isSuperUser,
    generalSettings?.superUserModeEnabled,
  ])

  const activeSection = useMemo(() => {
    const segments = pathname?.split('/') ?? []
    const settingsIdx = segments.indexOf('settings')
    if (settingsIdx !== -1 && segments[settingsIdx + 1]) {
      return segments[settingsIdx + 1] as SettingsSection
    }
    return 'general'
  }, [pathname])

  const handlePrefetch = useCallback(
    (itemId: string) => {
      switch (itemId) {
        case 'general':
          prefetchGeneralSettings(queryClient)
          void import('@/app/workspace/[workspaceId]/settings/components/general/general')
          break
        case 'integrations':
          prefetchWorkspaceCredentials(queryClient, workspaceId)
          void import('@/app/workspace/[workspaceId]/settings/components/integrations/integrations')
          break
        case 'secrets':
          prefetchWorkspaceCredentials(queryClient, workspaceId)
          void import('@/app/workspace/[workspaceId]/settings/components/credentials/credentials')
          break
        case 'subscription':
          prefetchSubscriptionData(queryClient)
          void import('@/app/workspace/[workspaceId]/settings/components/subscription/subscription')
          break
      }
    },
    [queryClient, workspaceId]
  )

  const { popSettingsReturnUrl, getSettingsHref } = useSettingsNavigation()

  const handleBack = useCallback(() => {
    if (isDirty) {
      setShowDiscardDialog(true)
      return
    }
    router.push(popSettingsReturnUrl(`/workspace/${workspaceId}/home`))
  }, [router, popSettingsReturnUrl, workspaceId, isDirty])

  const handleConfirmDiscard = useCallback(() => {
    const section = confirmNavigation()
    setShowDiscardDialog(false)
    if (section) {
      router.replace(getSettingsHref({ section }), { scroll: false })
    } else {
      router.push(popSettingsReturnUrl(`/workspace/${workspaceId}/home`))
    }
  }, [confirmNavigation, router, getSettingsHref, popSettingsReturnUrl, workspaceId])

  const handleCancelDiscard = useCallback(() => {
    cancelNavigation()
    setShowDiscardDialog(false)
  }, [cancelNavigation])

  return (
    <>
      {/* Back button */}
      <div className='mt-2.5 flex flex-shrink-0 flex-col gap-0.5 px-2'>
        <SidebarTooltip label='Back' enabled={showCollapsedTooltips}>
          <button
            type='button'
            onClick={handleBack}
            className='group mx-0.5 flex h-[30px] items-center gap-2 rounded-lg px-2 text-sm hover-hover:bg-[var(--surface-hover)]'
          >
            <div className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center text-[var(--text-icon)]'>
              <ChevronDown className='h-[10px] w-[10px] rotate-90' />
            </div>
            <span className='truncate font-base text-[var(--text-body)]'>Back</span>
          </button>
        </SidebarTooltip>
      </div>

      {/* Settings sections */}
      <div
        className={cn(
          'mt-3.5 flex flex-1 flex-col gap-3.5 pb-2',
          !isCollapsed && 'overflow-y-auto overflow-x-hidden'
        )}
      >
        {sessionLoading ||
        orgsLoading ||
        (isBillingEnabled && subscriptionLoading) ||
        permissionLoading ||
        (!isHosted && isLoadingSSO)
          ? SKELETON_SECTIONS.map((count, i) => (
              <div key={i} className='flex flex-shrink-0 flex-col'>
                <div className='sidebar-collapse-hide px-4 pb-1.5'>
                  <Skeleton className='h-[14px] w-[64px] rounded-sm' />
                </div>
                <div className='flex flex-col gap-0.5 px-2'>
                  {Array.from({ length: count }, (_, j) => (
                    <div key={j} className='mx-0.5 flex h-[30px] items-center gap-2 px-2'>
                      <Skeleton className='h-[16px] w-[16px] flex-shrink-0 rounded-sm' />
                      <Skeleton className='sidebar-collapse-hide h-[14px] w-full rounded-sm' />
                    </div>
                  ))}
                </div>
              </div>
            ))
          : sectionConfig.map(({ key, title }) => {
              const sectionItems = navigationItems.filter((item) => item.section === key)
              if (sectionItems.length === 0) return null

              return (
                <div key={key} className='flex flex-shrink-0 flex-col'>
                  <div className='px-4 pb-1.5'>
                    <div className='font-base text-[var(--text-icon)] text-small'>{title}</div>
                  </div>
                  <div className='flex flex-col gap-0.5 px-2'>
                    {sectionItems.map((item) => {
                      const Icon = item.icon
                      const active = activeSection === item.id
                      const isLocked = item.requiresMax && !subscriptionAccess.hasUsableMaxAccess
                      const itemClassName = cn(
                        'group mx-0.5 flex h-[30px] items-center gap-2 rounded-[8px] px-2 text-[14px]',
                        !active && 'hover-hover:bg-[var(--surface-hover)]',
                        active && 'bg-[var(--surface-active)]'
                      )
                      const content = (
                        <>
                          <Icon className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                          <span className='min-w-0 truncate font-base text-[var(--text-body)]'>
                            {item.label}
                          </span>
                          {isLocked && (
                            <span className='ml-auto shrink-0 rounded-[3px] bg-[var(--surface-5)] px-1 py-[1px] font-medium text-[9px] text-[var(--text-icon)] uppercase tracking-wide'>
                              Max
                            </span>
                          )}
                        </>
                      )

                      const element = item.externalUrl ? (
                        <a
                          href={item.externalUrl}
                          target='_blank'
                          rel='noopener noreferrer'
                          className={itemClassName}
                        >
                          {content}
                        </a>
                      ) : (
                        <button
                          type='button'
                          className={itemClassName}
                          onMouseEnter={() => handlePrefetch(item.id)}
                          onFocus={() => handlePrefetch(item.id)}
                          onClick={() => {
                            const section = item.id as SettingsSection
                            if (section === activeSection) return
                            if (!requestNavigation(section)) {
                              setShowDiscardDialog(true)
                              return
                            }
                            router.replace(getSettingsHref({ section }), { scroll: false })
                          }}
                        >
                          {content}
                        </button>
                      )

                      return (
                        <SidebarTooltip
                          key={`${item.id}-${isCollapsed}`}
                          label={item.label}
                          enabled={showCollapsedTooltips}
                        >
                          {element}
                        </SidebarTooltip>
                      )
                    })}
                  </div>
                </div>
              )
            })}
      </div>

      <Modal open={showDiscardDialog} onOpenChange={(open) => !open && handleCancelDiscard()}>
        <ModalContent size='sm'>
          <ModalHeader>Unsaved Changes</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              You have unsaved changes. Are you sure you want to discard them?
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={handleCancelDiscard}>
              Keep Editing
            </Button>
            <Button variant='destructive' onClick={handleConfirmDiscard}>
              Discard Changes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
