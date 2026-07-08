'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChipConfirmModal, chipVariants, cn } from '@sim/emcn'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionAccessState } from '@/lib/billing/client'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { isHosted } from '@/lib/core/config/env-flags'
import { getUserRole } from '@/lib/workspaces/organization'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import {
  allNavigationItems,
  isBillingEnabled,
  sectionConfig,
} from '@/app/workspace/[workspaceId]/settings/navigation'
import {
  SIDEBAR_ITEM_GAP_CLASS,
  SIDEBAR_SECTION_GAP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { SidebarTooltip } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'
import { useSSOProviders } from '@/ee/sso/hooks/sso'
import { prefetchWorkspaceCredentials } from '@/hooks/queries/credentials'
import { prefetchGeneralSettings, useGeneralSettings } from '@/hooks/queries/general-settings'
import { useInboxConfig } from '@/hooks/queries/inbox'
import { useOrganizations } from '@/hooks/queries/organization'
import { prefetchSubscriptionData, useSubscriptionData } from '@/hooks/queries/subscription'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface SettingsSidebarProps {
  isCollapsed?: boolean
  showCollapsedTooltips?: boolean
}

export function SettingsSidebar({
  isCollapsed = false,
  showCollapsedTooltips = false,
}: SettingsSidebarProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)

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
  const [hasOverflowTop, setHasOverflowTop] = useState(false)

  const { data: session } = useSession()
  const { data: organizationsData } = useOrganizations()
  const { data: generalSettings } = useGeneralSettings()
  const { data: subscriptionData } = useSubscriptionData({
    enabled: isBillingEnabled,
    staleTime: 5 * 60 * 1000,
  })
  const { data: inboxConfig } = useInboxConfig(workspaceId)
  const { data: ssoProvidersData, isLoading: isLoadingSSO } = useSSOProviders({
    enabled: !isHosted,
  })

  const activeOrganization = organizationsData?.activeOrganization
  const { config: permissionConfig } = usePermissionConfig()

  const userEmail = session?.user?.email
  const userId = session?.user?.id

  const userRole = getUserRole(activeOrganization, userEmail)
  const isOwner = userRole === 'owner'
  const isAdmin = userRole === 'admin'
  const isOrgAdminOrOwner = isOwner || isAdmin
  const subscriptionAccess = getSubscriptionAccessState(subscriptionData?.data)
  const inboxEntitled = inboxConfig?.entitled ?? false
  const hasTeamPlan = subscriptionAccess.hasUsableTeamAccess
  const hasEnterprisePlan = subscriptionAccess.hasUsableEnterpriseAccess
  const isEnterprisePlan = isEnterprise(subscriptionData?.data?.plan)

  const isSuperUser = session?.user?.role === 'admin'

  const isSSOProviderOwner = useMemo(() => {
    if (isHosted) return null
    if (!userId || isLoadingSSO) return null
    return ssoProvidersData?.providers?.some((p) => p.userId === userId) || false
  }, [userId, ssoProvidersData?.providers, isLoadingSSO])

  const navigationItems = useMemo(() => {
    return allNavigationItems.filter((item) => {
      if (item.hideWhenBillingDisabled && !isBillingEnabled) {
        return false
      }

      if (item.hideForEnterprise && isEnterprisePlan) {
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

      if (item.selfHostedOverride && !isHosted) {
        if (item.id === 'sso') {
          const hasProviders = (ssoProvidersData?.providers?.length ?? 0) > 0
          return !hasProviders || isSSOProviderOwner === true
        }
        return true
      }

      const orgAdminSatisfied = isOrgAdminOrOwner || item.allowNonOrgAdmin

      if (item.requiresTeam && (!hasTeamPlan || !orgAdminSatisfied)) {
        return false
      }

      if (
        item.requiresEnterprise &&
        (!hasEnterprisePlan || !orgAdminSatisfied) &&
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
    isEnterprisePlan,
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
        case 'secrets':
          prefetchWorkspaceCredentials(queryClient, workspaceId)
          void import('@/app/workspace/[workspaceId]/settings/components/secrets/secrets')
          break
        case 'billing':
          prefetchSubscriptionData(queryClient)
          void import('@/app/workspace/[workspaceId]/settings/components/billing/billing')
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

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const updateScrollState = () => {
      setHasOverflowTop(container.scrollTop > 1)
    }

    updateScrollState()
    container.addEventListener('scroll', updateScrollState, { passive: true })
    const observer = new ResizeObserver(updateScrollState)
    observer.observe(container)
    if (scrollContentRef.current) {
      observer.observe(scrollContentRef.current)
    }

    return () => {
      container.removeEventListener('scroll', updateScrollState)
      observer.disconnect()
    }
  }, [isCollapsed])

  return (
    <>
      {/* Back button */}
      <div
        className={cn(
          SIDEBAR_SECTION_GAP_CLASS,
          SIDEBAR_ITEM_GAP_CLASS,
          'flex flex-shrink-0 flex-col px-2 pb-1.5'
        )}
      >
        <SidebarTooltip label='Back' enabled={showCollapsedTooltips}>
          <button type='button' onClick={handleBack} className={chipVariants({ fullWidth: true })}>
            <div className='flex size-[16px] flex-shrink-0 items-center justify-center text-[var(--text-icon)]'>
              <ChevronDown className='size-[10px] rotate-90' />
            </div>
            <span className='sidebar-collapse-hide truncate text-[var(--text-body)]'>Back</span>
          </button>
        </SidebarTooltip>
      </div>

      {/* Settings sections */}
      <div
        ref={isCollapsed ? undefined : scrollContainerRef}
        className={cn(
          'flex flex-1 flex-col overflow-y-auto overflow-x-hidden border-t pt-1.5 transition-colors duration-150',
          !hasOverflowTop && 'border-transparent'
        )}
      >
        <div ref={scrollContentRef} className='flex flex-col'>
          {sectionConfig
            .map(({ key, title }) => ({
              key,
              title,
              items: navigationItems.filter((item) => item.section === key),
            }))
            .filter(({ items }) => items.length > 0)
            .map(({ key, title, items: sectionItems }, index) => (
              <div
                key={key}
                className={cn(
                  index > 0 && SIDEBAR_SECTION_GAP_CLASS,
                  'flex flex-shrink-0 flex-col'
                )}
              >
                <div className='px-4 pb-2'>
                  <div className='text-[var(--text-muted)] text-small'>{title}</div>
                </div>
                <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
                  {sectionItems.map((item) => {
                    const Icon = item.icon
                    const active = activeSection === item.id
                    const isLocked =
                      item.requiresMax &&
                      (item.id === 'inbox'
                        ? !inboxEntitled
                        : !subscriptionAccess.hasUsableMaxAccess)
                    const itemClassName = chipVariants({ active, fullWidth: true })
                    const content = (
                      <>
                        <Icon className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                        <span className='sidebar-collapse-hide min-w-0 truncate text-[var(--text-body)]'>
                          {item.label}
                        </span>
                        {isLocked && (
                          <span className='sidebar-collapse-hide ml-auto shrink-0 rounded-[3px] bg-[var(--surface-5)] px-1 py-[1px] font-medium text-[9px] text-[var(--text-icon)] uppercase tracking-wide'>
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
                        key={item.id}
                        label={item.label}
                        enabled={showCollapsedTooltips}
                      >
                        {element}
                      </SidebarTooltip>
                    )
                  })}
                </div>
              </div>
            ))}
        </div>
      </div>

      <ChipConfirmModal
        open={showDiscardDialog}
        onOpenChange={(open) => !open && handleCancelDiscard()}
        srTitle='Unsaved changes'
        title='Unsaved changes'
        text='You have unsaved changes. Are you sure you want to discard them?'
        dismissLabel='Keep editing'
        confirm={{
          label: 'Discard changes',
          onClick: handleConfirmDiscard,
        }}
      />
    </>
  )
}
