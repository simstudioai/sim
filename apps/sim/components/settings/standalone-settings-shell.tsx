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
  getSelfHostSettingsHref,
  isOrganizationSettingsSectionAvailable,
  ORGANIZATION_SETTINGS_GROUPS,
  ORGANIZATION_SETTINGS_ITEMS,
  ORGANIZATION_SETTINGS_PATH_ALIASES,
  parseSettingsPathSection,
  resolveOrganizationSectionAccess,
  SELFHOST_SETTINGS_GROUPS,
  SELFHOST_SETTINGS_ITEMS,
  SETTINGS_PLANE_CHROME,
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
  isEffectiveSuperUser?: boolean
}

interface SelfHostSettingsShellProps extends StandaloneSettingsShellBaseProps {
  plane: 'selfhost'
}

interface OrganizationSettingsShellProps extends StandaloneSettingsShellBaseProps {
  plane: 'organization'
  organizationId: string
  hasEnterprisePlan: boolean
  isOrganizationAdmin: boolean
}

type StandaloneSettingsShellProps =
  | AccountSettingsShellProps
  | OrganizationSettingsShellProps
  | SelfHostSettingsShellProps

export function StandaloneSettingsShell(props: StandaloneSettingsShellProps) {
  const { children, plane } = props
  useSettingsBeforeUnload()
  const pathname = usePathname()
  const hasEnterprisePlan = plane === 'organization' ? props.hasEnterprisePlan : false
  const isOrganizationAdmin = plane === 'organization' ? props.isOrganizationAdmin : false
  const isSuperUser = plane === 'account' ? (props.isSuperUser ?? false) : false
  const isEffectiveSuperUser = plane === 'account' ? (props.isEffectiveSuperUser ?? false) : false

  const organizationFeatures = getOrganizationSettingsFeatures(hasEnterprisePlan)
  const accountItems = ACCOUNT_SETTINGS_ITEMS.filter((item) => {
    if (item.id === 'billing' && !isBillingEnabled) return false
    if ((item.id === 'admin' || item.id === 'mothership') && !isSuperUser) return false
    if (item.id === 'newsletters' && !isEffectiveSuperUser) return false
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
  const selfHostItems = SELFHOST_SETTINGS_ITEMS.filter((item) => {
    if (item.id === 'billing' && !isBillingEnabled) return false
    // Chat keys are issued by the managed service, so there are none to list on
    // a self-hosted deployment — useCopilotKeys is `enabled: isHosted` for the
    // same reason. Self-hosters manage their keys on sim.ai.
    if (item.id === 'chat-keys' && !isHosted) return false
    return true
  })
  const selfHostSection = parseSettingsPathSection({
    path: pathname,
    items: SELFHOST_SETTINGS_ITEMS,
    defaultSection: 'general',
  })
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
  const activeSection =
    plane === 'account'
      ? accountSection
      : plane === 'selfhost'
        ? selfHostSection
        : organizationSection
  const sidebar =
    plane === 'selfhost' ? (
      <SettingsSidebar
        activeSection={selfHostSection}
        plane={plane}
        groups={SELFHOST_SETTINGS_GROUPS}
        hrefForSection={getSelfHostSettingsHref}
        items={selfHostItems}
      />
    ) : plane === 'account' ? (
      <SettingsSidebar
        activeSection={accountSection}
        plane={plane}
        groups={ACCOUNT_SETTINGS_GROUPS}
        hrefForSection={getAccountSettingsHref}
        items={accountItems}
      />
    ) : (
      <SettingsSidebar
        activeSection={organizationSection}
        plane={plane}
        groups={ORGANIZATION_SETTINGS_GROUPS}
        hrefForSection={(section) => getOrganizationSettingsHref(props.organizationId, section)}
        items={organizationItems}
      />
    )

  return (
    <ToastProvider>
      {/*
        Mirrors the in-workspace chrome (WorkspaceChrome): a flush, borderless
        sidebar column against the app surface, and only the content pane
        carrying the rounded border. Keep the two in step — a settings page
        should look the same whether it is reached inside a workspace or not.
      */}
      <div className='flex h-screen w-full overflow-hidden bg-[var(--surface-1)]'>
        <aside
          className='flex h-full w-[248px] flex-shrink-0 flex-col overflow-hidden bg-[var(--surface-1)] pt-3'
          aria-label={`${SETTINGS_PLANE_CHROME[plane].label} settings navigation`}
        >
          {sidebar}
        </aside>
        <div className='flex min-w-0 flex-1 flex-col p-[8px] pl-0'>
          <main className='flex-1 overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--bg)]'>
            <SettingsHeaderProvider>
              <SettingsHeaderShell>
                <SettingsSectionProvider plane={plane} section={activeSection}>
                  {children}
                </SettingsSectionProvider>
              </SettingsHeaderShell>
            </SettingsHeaderProvider>
          </main>
        </div>
      </div>
    </ToastProvider>
  )
}
