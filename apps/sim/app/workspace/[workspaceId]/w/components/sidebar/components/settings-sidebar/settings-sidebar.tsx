'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Chip,
  ChipConfirmModal,
  ChipTag,
  chipContentIconClass,
  chipVariants,
  cn,
  OverflowText,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn'
import { ArrowUpRight, Building, ChevronLeft } from '@sim/emcn/icons'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, usePathname, useRouter } from 'next/navigation'
import {
  type DesktopSettingsSurface,
  getOrganizationSettingsHref,
  isSelfHostedOverrideEnabled,
  ORGANIZATION_PLANE_UNIFIED_SECTIONS,
} from '@/components/settings/navigation'
import { SettingsIntentLink } from '@/components/settings/settings-intent-link'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionAccessState } from '@/lib/billing/client'
import { canViewWorkspaceBillingSettings } from '@/lib/billing/workspace-permissions'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { hasBrowserAgent, hasDesktopSettings, hasTerminal } from '@/lib/desktop'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import {
  allNavigationItems,
  sectionConfig,
} from '@/app/workspace/[workspaceId]/settings/navigation'
import { warmSettingsSectionQuery } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-sidebar/settings-query-warmers'
import { SidebarSection } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-section'
import { SidebarTooltip } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-tooltip'
import {
  SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
  SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
  SIDEBAR_ITEM_GAP_CLASS,
  SIDEBAR_RAIL_CHIP_CLASS,
  SIDEBAR_SECTION_GAP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useSSOProviders } from '@/ee/sso/hooks/sso'
import { useForkingAvailable } from '@/ee/workspace-forking/hooks/use-forking-available'
import { useGeneralSettings } from '@/hooks/queries/general-settings'
import { useInboxConfig } from '@/hooks/queries/inbox'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

/**
 * Sections whose JS chunk is warmed when a row receives navigation intent.
 *
 * Deliberately not all of them, and the reason is the boundary audit rather than bundle weight.
 * Each section is already `dynamic()`-imported by the settings panel, so naming it here adds an
 * async-chunk reference, not parsed JS — but `check-tool-registry-boundary` counts `import()`
 * as a graph edge on purpose, and listing all of them measured +126..+172 modules against six of
 * the app's hottest route baselines. Code-splitting this sidebar does not help: measured, it
 * moves exactly one module, because the audit follows the dynamic edge either way.
 *
 * These six predate this map and are already inside those baselines, so warming them is free.
 * Widening it means either raising the ratchet on the routes it exists to protect, or teaching
 * the audit to track async reach separately from initial-chunk weight.
 *
 * Every section still gets its route payload warmed through {@link SettingsIntentLink}.
 */
const SECTION_CHUNK_WARMERS: Partial<Record<SettingsSection, () => Promise<unknown>>> = {
  general: () => import('@/app/workspace/[workspaceId]/settings/components/general/general'),
  secrets: () => import('@/app/workspace/[workspaceId]/settings/components/secrets/secrets'),
  billing: () => import('@/app/workspace/[workspaceId]/settings/components/billing/billing'),
  desktop: () => import('@/app/workspace/[workspaceId]/settings/components/desktop/desktop'),
  browser: () => import('@/app/workspace/[workspaceId]/settings/components/browser/browser'),
  terminal: () => import('@/app/workspace/[workspaceId]/settings/components/terminal/terminal'),
}

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

  const scrollEdges = useScrollEdges(scrollContainerRef, {
    contentRef: scrollContentRef,
    enabled: !isCollapsed,
  })
  const [desktopSurfaces, setDesktopSurfaces] = useState<Record<DesktopSettingsSurface, boolean>>({
    settings: false,
    browser: false,
    terminal: false,
  })

  const { data: session } = useSession()
  const hostContext = useWorkspaceHostContext()
  const deployment = useDeploymentShape()
  const { hosted, billingEnabled } = deployment
  const { data: generalSettings } = useGeneralSettings()
  const { data: inboxConfig } = useInboxConfig(workspaceId)
  const { data: ssoProvidersData, isLoading: isLoadingSSO } = useSSOProviders({
    enabled: !hosted,
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

  const isSSOProviderOwner =
    hosted || !userId || isLoadingSSO
      ? null
      : (ssoProvidersData?.providers?.some((provider) => provider.userId === userId) ?? false)

  const navigationItems = useMemo(() => {
    return allNavigationItems.filter((item) => {
      if (hostContext.hostOrganizationId && ORGANIZATION_PLANE_UNIFIED_SECTIONS.has(item.id)) {
        return false
      }
      if (item.requiresSelfHosted && hosted) {
        return false
      }

      if (item.requiresDesktopSurface && !desktopSurfaces[item.requiresDesktopSurface]) {
        return false
      }

      if (item.hideWhenBillingDisabled && !billingEnabled) {
        return false
      }

      if (item.id === 'billing' && !canViewWorkspaceBillingSettings(hostContext, userId)) {
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
      if (item.id === 'sandboxes' && permissionConfig.hideSandboxesTab) {
        return false
      }
      if (item.id === 'forks' && !(forkingAvailable && canAdminWorkspace)) {
        return false
      }
      if (item.id === 'custom-blocks' && !hostContext.hostOrganizationId) {
        return false
      }

      if (isSelfHostedOverrideEnabled(item.selfHostedOverride, deployment)) {
        /**
         * Org-plane sections route through the organization gate in
         * `settings/[section]/page.tsx` (host organization + org-admin viewer),
         * which 404s other viewers — mirror it here so the item never links to
         * a dead page.
         */
        if (ORGANIZATION_PLANE_UNIFIED_SECTIONS.has(item.id) && !isOrgAdminOrOwner) {
          return false
        }
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

      if (item.requiresHosted && !hosted) {
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
    deployment,
    hosted,
    billingEnabled,
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
    desktopSurfaces,
  ])

  const segments = pathname?.split('/') ?? []
  const settingsIndex = segments.indexOf('settings')
  const activeSection: SettingsSection =
    settingsIndex !== -1 && segments[settingsIndex + 1]
      ? (segments[settingsIndex + 1] as SettingsSection)
      : 'general'

  const { popSettingsReturnUrl, getSettingsHref } = useSettingsNavigation()

  const handleIntent = (section: SettingsSection) => {
    void SECTION_CHUNK_WARMERS[section]?.()
    warmSettingsSectionQuery(
      queryClient,
      { workspaceId, billingOrganizationId: hostContext.hostOrganizationId },
      section
    )
  }

  const handleBack = useCallback(() => {
    requestLeave(() => {
      router.push(popSettingsReturnUrl(`/workspace/${workspaceId}`))
    })
  }, [requestLeave, router, popSettingsReturnUrl, workspaceId])

  const handleConfirmDiscard = useCallback(() => {
    confirmLeave()
  }, [confirmLeave])

  const handleCancelDiscard = useCallback(() => {
    cancelLeave()
  }, [cancelLeave])

  useEffect(() => {
    setDesktopSurfaces({
      settings: hasDesktopSettings(),
      browser: hasBrowserAgent(),
      terminal: hasTerminal(),
    })
  }, [])

  return (
    <>
      {/* The divider is the pinned block's bottom rule, not the scroll region's top one:
          the region's edge fade masks its own first pixels, which would erase a rule
          drawn there exactly when it should show. Same construction as the footer. */}
      <div
        className={cn(
          SIDEBAR_SECTION_GAP_CLASS,
          SIDEBAR_ITEM_GAP_CLASS,
          SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
          'flex shrink-0 flex-col border-b px-2 transition-colors duration-150',
          !scrollEdges.top && 'border-transparent'
        )}
      >
        <SidebarTooltip label='Back' enabled={showCollapsedTooltips}>
          <Chip
            fullWidth
            leftIcon={ChevronLeft}
            onClick={handleBack}
            className={SIDEBAR_RAIL_CHIP_CLASS}
          >
            <span className='sidebar-collapse-hide'>Back</span>
          </Chip>
        </SidebarTooltip>
      </div>

      <div
        ref={isCollapsed ? undefined : scrollContainerRef}
        className={cn(
          SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
          SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
          scrollFadeClass,
          'flex flex-1 flex-col overflow-y-auto overflow-x-hidden'
        )}
        {...scrollFadeAttributes(scrollEdges)}
      >
        <div ref={scrollContentRef} className='flex flex-col'>
          {sectionConfig
            .map(({ key, title }) => ({
              key,
              title,
              items: navigationItems
                .filter((item) => item.section === key)
                .sort((left, right) => left.order - right.order),
            }))
            .filter(
              ({ key, items }) =>
                items.length > 0 ||
                (key === 'organization' &&
                  hostContext.hostOrganizationId &&
                  hostContext.viewer.isHostOrganizationMember)
            )
            .map(({ key, title, items: sectionItems }, index) => (
              <SidebarSection
                key={key}
                title={title}
                railCollapsed={isCollapsed}
                className={cn(index > 0 && SIDEBAR_SECTION_GAP_CLASS, 'shrink-0')}
              >
                <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
                  {key === 'organization' &&
                    hostContext.hostOrganizationId &&
                    hostContext.viewer.isHostOrganizationMember && (
                      <SidebarTooltip label='Organization' enabled={showCollapsedTooltips}>
                        <SettingsIntentLink
                          href={getOrganizationSettingsHref(
                            hostContext.hostOrganizationId,
                            'members'
                          )}
                          className={cn(chipVariants({ fullWidth: true }), SIDEBAR_RAIL_CHIP_CLASS)}
                          onNavigate={(event) => {
                            if (!useSettingsDirtyStore.getState().isDirty) return
                            event.preventDefault()
                            const organizationId = hostContext.hostOrganizationId
                            if (organizationId)
                              requestLeave(() =>
                                router.push(getOrganizationSettingsHref(organizationId, 'members'))
                              )
                          }}
                        >
                          <Building className={chipContentIconClass} />
                          <OverflowText
                            label='Organization'
                            className='sidebar-collapse-hide text-[var(--text-body)]'
                          />
                          <ArrowUpRight
                            className={cn('sidebar-collapse-hide ml-auto', chipContentIconClass)}
                          />
                        </SettingsIntentLink>
                      </SidebarTooltip>
                    )}
                  {sectionItems.map((item) => {
                    const Icon = item.icon
                    const active = activeSection === item.id
                    const section = item.id as SettingsSection
                    const href = getSettingsHref({ section })
                    const selfHostedUnlocked = isSelfHostedOverrideEnabled(
                      item.selfHostedOverride,
                      deployment
                    )
                    const isLocked =
                      !selfHostedUnlocked &&
                      item.requiresMax &&
                      (item.id === 'inbox'
                        ? !inboxEntitled
                        : !subscriptionAccess.hasUsableMaxAccess)
                    const itemClassName = cn(
                      chipVariants({ active, fullWidth: true }),
                      SIDEBAR_RAIL_CHIP_CLASS
                    )
                    const content = (
                      <>
                        <Icon className={chipContentIconClass} />
                        <OverflowText
                          label={item.label}
                          className='sidebar-collapse-hide text-[var(--text-body)]'
                          tooltipEnabled={!showCollapsedTooltips}
                        />
                        {isLocked && (
                          <ChipTag
                            variant='mono'
                            className='sidebar-collapse-hide ml-auto shrink-0'
                          >
                            Max
                          </ChipTag>
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
                      <SettingsIntentLink
                        href={href}
                        replace
                        scroll={false}
                        aria-current={active ? 'page' : undefined}
                        className={itemClassName}
                        onIntent={() => handleIntent(section)}
                        onNavigate={(event) => {
                          if (active) {
                            event.preventDefault()
                            return
                          }
                          if (!useSettingsDirtyStore.getState().isDirty) return
                          event.preventDefault()
                          requestLeave(() => router.replace(href, { scroll: false }))
                        }}
                      >
                        {content}
                      </SettingsIntentLink>
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
              </SidebarSection>
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
