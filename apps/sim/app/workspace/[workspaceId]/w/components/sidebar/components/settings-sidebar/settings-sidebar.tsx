'use client'

import { useMemo } from 'react'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionStatus } from '@/lib/billing/client'
import { isHosted } from '@/lib/core/config/feature-flags'
import { cn } from '@/lib/core/utils/cn'
import { getUserRole } from '@/lib/workspaces/organization'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import {
  allNavigationItems,
  isBillingEnabled,
  sectionConfig,
} from '@/app/workspace/[workspaceId]/settings/navigation'
import { useSSOProviders } from '@/ee/sso/hooks/sso'
import { useGeneralSettings } from '@/hooks/queries/general-settings'
import { useOrganizations } from '@/hooks/queries/organization'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import { useSuperUserStatus } from '@/hooks/queries/user-profile'
import { usePermissionConfig } from '@/hooks/use-permission-config'

export function SettingsSidebar() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const pathname = usePathname()
  const router = useRouter()

  const { data: session } = useSession()
  const { data: organizationsData } = useOrganizations()
  const { data: generalSettings } = useGeneralSettings()
  const { data: subscriptionData } = useSubscriptionData({ enabled: isBillingEnabled })
  const { data: ssoProvidersData, isLoading: isLoadingSSO } = useSSOProviders()
  const { data: superUserData } = useSuperUserStatus(session?.user?.id)

  const activeOrganization = organizationsData?.activeOrganization
  const { config: permissionConfig } = usePermissionConfig()

  const userEmail = session?.user?.email
  const userId = session?.user?.id

  const userRole = getUserRole(activeOrganization, userEmail)
  const isOwner = userRole === 'owner'
  const isAdmin = userRole === 'admin'
  const isOrgAdminOrOwner = isOwner || isAdmin
  const subscriptionStatus = getSubscriptionStatus(subscriptionData?.data)
  const hasTeamPlan = subscriptionStatus.isTeam || subscriptionStatus.isEnterprise
  const hasEnterprisePlan = subscriptionStatus.isEnterprise

  const isSuperUser = superUserData?.isSuperUser ?? false

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

      if (item.id === 'template-profile' && permissionConfig.hideTemplates) {
        return false
      }
      if (item.id === 'apikeys' && permissionConfig.hideApiKeysTab) {
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

      if (item.requiresEnterprise && (!hasEnterprisePlan || !isOrgAdminOrOwner)) {
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

      return true
    })
  }, [
    hasTeamPlan,
    hasEnterprisePlan,
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

  const handleBack = () => {
    router.push(`/workspace/${workspaceId}/home`)
  }

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      {/* Back button */}
      <div className='mt-[10px] flex flex-shrink-0 flex-col gap-[2px] px-[8px]'>
        <button
          type='button'
          onClick={handleBack}
          className='group mx-[2px] flex h-[30px] items-center gap-[8px] rounded-[8px] px-[8px] text-[14px] hover:bg-[var(--surface-active)]'
        >
          <ArrowLeft className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-muted)]' />
          <span className='truncate font-base text-[var(--text-secondary)]'>Back</span>
        </button>
      </div>

      {/* Settings sections */}
      <div className='mt-[14px] flex flex-1 flex-col overflow-y-auto overflow-x-hidden'>
        {sectionConfig.map(({ key, title }) => {
          const sectionItems = navigationItems.filter((item) => item.section === key)
          if (sectionItems.length === 0) return null

          return (
            <div key={key} className='flex flex-shrink-0 flex-col pb-[5px]'>
              <div className='px-[16px] pb-[6px]'>
                <div className='font-base text-[var(--text-tertiary)] text-small'>{title}</div>
              </div>
              <div className='flex flex-col gap-[2px] px-[8px]'>
                {sectionItems.map((item) => {
                  const Icon = item.icon
                  const active = activeSection === item.id
                  const textColor = active
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)]'
                  const iconColor = active
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)]'

                  return (
                    <Link
                      key={item.id}
                      href={`/workspace/${workspaceId}/settings/${item.id}`}
                      className={cn(
                        'group mx-[2px] flex h-[30px] items-center gap-[8px] rounded-[8px] px-[8px] text-[14px] hover:bg-[var(--surface-active)]',
                        active && 'bg-[var(--surface-active)]'
                      )}
                    >
                      <Icon className={`h-[16px] w-[16px] flex-shrink-0 ${iconColor}`} />
                      <span className={`truncate font-base ${textColor}`}>{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
