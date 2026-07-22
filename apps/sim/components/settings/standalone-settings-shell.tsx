'use client'

import type { ReactNode } from 'react'
import { ToastProvider } from '@sim/emcn'
import { usePathname } from 'next/navigation'
import {
  ACCOUNT_SETTINGS_GROUPS,
  ACCOUNT_SETTINGS_ITEMS,
  ACCOUNT_SETTINGS_PATH_ALIASES,
  getAccountSettingsHref,
  getOrganizationSettingsFeatures,
  getOrganizationSettingsHref,
  isOrganizationSettingsSectionAvailable,
  ORGANIZATION_SETTINGS_GROUPS,
  ORGANIZATION_SETTINGS_ITEMS,
  ORGANIZATION_SETTINGS_PATH_ALIASES,
  parseSettingsPathSection,
  resolveOrganizationSectionAccess,
} from '@/components/settings/navigation'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { SettingsSectionProvider } from '@/components/settings/settings-panel'
import { SettingsSidebar } from '@/components/settings/settings-sidebar'
import { useSettingsBeforeUnload } from '@/components/settings/use-settings-before-unload'
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'

interface StandaloneSettingsShellBaseProps {
  children: ReactNode
}

interface AccountSettingsShellProps extends StandaloneSettingsShellBaseProps {
  plane: 'account'
  isSuperUser?: boolean
}

interface OrganizationSettingsShellProps extends StandaloneSettingsShellBaseProps {
  plane: 'organization'
  organizationId: string
  hasEnterprisePlan: boolean
  isOrganizationAdmin: boolean
}

type StandaloneSettingsShellProps = AccountSettingsShellProps | OrganizationSettingsShellProps

export function StandaloneSettingsShell(props: StandaloneSettingsShellProps) {
  const { children, plane } = props
  useSettingsBeforeUnload()
  const pathname = usePathname()
  const hasEnterprisePlan = plane === 'organization' ? props.hasEnterprisePlan : false
  const isOrganizationAdmin = plane === 'organization' ? props.isOrganizationAdmin : false
  const isSuperUser = plane === 'account' ? (props.isSuperUser ?? false) : false

  const organizationFeatures = getOrganizationSettingsFeatures(hasEnterprisePlan)
  const accountItems = ACCOUNT_SETTINGS_ITEMS.filter((item) => {
    if (item.id === 'billing' && !isBillingEnabled) return false
    if (item.id === 'copilot' && !isHosted) return false
    if ((item.id === 'admin' || item.id === 'mothership') && !isSuperUser) return false
    return true
  })
  const organizationItems = ORGANIZATION_SETTINGS_ITEMS.filter(
    (item) =>
      resolveOrganizationSectionAccess({
        section: item.id,
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: isOrganizationAdmin,
      }) !== 'unavailable' && isOrganizationSettingsSectionAvailable(item.id, organizationFeatures)
  )
  const accountSection = parseSettingsPathSection({
    path: pathname,
    items: ACCOUNT_SETTINGS_ITEMS,
    defaultSection: 'general',
    aliases: ACCOUNT_SETTINGS_PATH_ALIASES,
  })
  const organizationSection = parseSettingsPathSection({
    path: pathname,
    items: ORGANIZATION_SETTINGS_ITEMS,
    defaultSection: 'members',
    aliases: ORGANIZATION_SETTINGS_PATH_ALIASES,
  })
  const activeSection = plane === 'account' ? accountSection : organizationSection
  const sidebar =
    plane === 'account' ? (
      <SettingsSidebar
        activeSection={accountSection}
        backHref='/workspace'
        groups={ACCOUNT_SETTINGS_GROUPS}
        hrefForSection={getAccountSettingsHref}
        items={accountItems}
      />
    ) : (
      <SettingsSidebar
        activeSection={organizationSection}
        backHref='/workspace'
        groups={ORGANIZATION_SETTINGS_GROUPS}
        hrefForSection={(section) => getOrganizationSettingsHref(props.organizationId, section)}
        items={organizationItems}
      />
    )

  return (
    <ToastProvider>
      <div className='desktop-title-bar-page-height flex w-full overflow-hidden bg-[var(--surface-1)] p-2'>
        <aside
          className='mr-2 flex w-[248px] flex-shrink-0 flex-col rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] pt-3'
          aria-label={`${plane === 'account' ? 'Account' : 'Organization'} settings navigation`}
        >
          {sidebar}
        </aside>
        <main className='min-w-0 flex-1 overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--bg)]'>
          <SettingsHeaderProvider>
            <SettingsHeaderShell>
              <SettingsSectionProvider plane={plane} section={activeSection}>
                {children}
              </SettingsSectionProvider>
            </SettingsHeaderShell>
          </SettingsHeaderProvider>
        </main>
      </div>
    </ToastProvider>
  )
}
