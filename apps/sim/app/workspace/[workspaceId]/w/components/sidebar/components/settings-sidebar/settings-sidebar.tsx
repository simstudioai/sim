'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChipConfirmModal, chipVariants, cn } from '@sim/emcn'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionAccessState } from '@/lib/billing/client'
import { canManageWorkspaceBilling } from '@/lib/billing/workspace-permissions'
import { isHosted } from '@/lib/core/config/env-flags'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
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
import { useForkingAvailable } from '@/ee/workspace-forking/hooks/use-forking-available'
import { prefetchWorkspaceCredentials } from '@/hooks/queries/credentials'
import { prefetchGeneralSettings, useGeneralSettings } from '@/hooks/queries/general-settings'
import { useInboxConfig } from '@/hooks/queries/inbox'
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

  const requestLeave = useSettingsDirtyStore((s) => s.requestLeave)
  const confirmLeave = useSettingsDirtyStore((s) => s.confirmLeave)
  const cancelLeave = useSettingsDirtyStore((s) => s.cancelLeave)
  const pendingLeave = useSettingsDirtyStore((s) => s.pendingLeave)
  const showDiscardDialog = pendingLeave !== null

  const [hasOverflowTop, setHasOverflowTop] = useState(false)

  const { data: session } = useSession()
  const hostContext = useWorkspaceHostContext()
  const { data: generalSettings } = useGeneralSettings()
  const { data: inboxConfig } = useInboxConfig(workspaceId)
  const { data: ssoProvidersData, isLoading: isLoadingSSO } = useSSOProviders({
    enabled: !isHosted,
  })

  const { config: permissionConfig } = usePermissionConfig()
  const forkingAvailable = useForkingAvailable(workspaceId)
  const { canAdmin: canAdminWorkspace } = useUserPermissionsContext()

  const userId = session?.user?.id

  const isOrgAdminOrOwner = hostContext.viewer.isHostOrganizationAdmin
  const subscriptionAccess = getSubscriptionAccessState(hostContext.ownerBilling)
  const inboxEntitled = inboxConfig?.entitled ?? false
  const hasTeamPlan = subscriptionAccess.hasUsableTeamAccess
  const hasEnterprisePlan = subscriptionAccess.hasUsableEnterpriseAccess
  const isEnterprisePlan = subscriptionAccess.isEnterprise

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

      if (item.id === 'billing' && !canManageWorkspaceBilling(hostContext, userId)) {
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
      if (item.id === 'forks' && !(forkingAvailable && canAdminWorkspace)) {
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
    hostContext,
    userId,
    isOrgAdminOrOwner,
    isSSOProviderOwner,
    ssoProvidersData?.providers?.length,
    permissionConfig,
    isSuperUser,
    generalSettings?.superUserModeEnabled,
    forkingAvailable,
    canAdminWorkspace,
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
          void import('@/app/workspace/[workspaceId]/settings/components/billing/billing')
          break
      }
    },
    [queryClient, workspaceId]
  )

  const { popSettingsReturnUrl, getSettingsHref } = useSettingsNavigation()

  const handleBack = useCallback(() => {
    requestLeave(() => {
      router.push(popSettingsReturnUrl(`/workspace/${workspaceId}/home`))
    })
  }, [requestLeave, router, popSettingsReturnUrl, workspaceId])

  const handleConfirmDiscard = useCallback(() => {
    confirmLeave()
  }, [confirmLeave])

  const handleCancelDiscard = useCallback(() => {
    cancelLeave()
  }, [cancelLeave])

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
                          requestLeave(() => {
                            router.replace(getSettingsHref({ section }), { scroll: false })
                          })
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
