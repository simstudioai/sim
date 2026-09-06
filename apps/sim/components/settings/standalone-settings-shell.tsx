'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import {
  ACCOUNT_SETTINGS_GROUPS,
  ACCOUNT_SETTINGS_ITEMS,
  ACCOUNT_SETTINGS_PATH_ALIASES,
  getAccountSettingsHref,
  getSelfHostSettingsHref,
  parseSettingsPathSection,
  SELFHOST_SETTINGS_GROUPS,
  SELFHOST_SETTINGS_ITEMS,
  SETTINGS_PLANE_CHROME,
} from '@/components/settings/navigation'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { SettingsSectionProvider } from '@/components/settings/settings-panel'
import { SettingsSidebar } from '@/components/settings/settings-sidebar'
import { useSettingsBeforeUnload } from '@/components/settings/use-settings-before-unload'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { SIDEBAR_WIDTH } from '@/stores/constants'

interface StandaloneSettingsShellBaseProps {
  children: ReactNode
}

interface AccountSettingsShellProps extends StandaloneSettingsShellBaseProps {
  plane: 'account'
  isSuperUser?: boolean
}

interface SelfHostSettingsShellProps extends StandaloneSettingsShellBaseProps {
  plane: 'selfhost'
}

type StandaloneSettingsShellProps = AccountSettingsShellProps | SelfHostSettingsShellProps

export function StandaloneSettingsShell(props: StandaloneSettingsShellProps) {
  const { children, plane } = props
  useSettingsBeforeUnload()
  const pathname = usePathname()
  const { hosted, billingEnabled } = useDeploymentShape()
  const isSuperUser = plane === 'account' ? (props.isSuperUser ?? false) : false

  const accountItems = ACCOUNT_SETTINGS_ITEMS.filter((item) => {
    if (item.id === 'billing' && !billingEnabled) return false
    if ((item.id === 'admin' || item.id === 'mothership') && !isSuperUser) return false
    return true
  })
  const selfHostItems = SELFHOST_SETTINGS_ITEMS.filter((item) => {
    if (item.id === 'billing' && !billingEnabled) return false
    // Chat keys are issued by the managed service, so there are none to list on
    // a self-hosted deployment — useCopilotKeys is `enabled: hosted` for the
    // same reason. Self-hosters manage their keys on sim.ai.
    if (item.id === 'chat-keys' && !hosted) return false
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
  const activeSection = plane === 'account' ? accountSection : selfHostSection
  const sidebar =
    plane === 'account' ? (
      <SettingsSidebar
        activeSection={accountSection}
        plane={plane}
        groups={ACCOUNT_SETTINGS_GROUPS}
        hrefForSection={getAccountSettingsHref}
        items={accountItems}
      />
    ) : (
      <SettingsSidebar
        activeSection={selfHostSection}
        plane={plane}
        groups={SELFHOST_SETTINGS_GROUPS}
        hrefForSection={getSelfHostSettingsHref}
        items={selfHostItems}
      />
    )

  return (
    <div className='flex h-screen w-full overflow-hidden bg-[var(--surface-1)]'>
      {/*
        Mirrors the in-workspace chrome (WorkspaceChrome): a flush, borderless
        sidebar column against the app surface, meeting the content pane on a
        single hairline divider with no gutter. Keep the two in step — a settings
        page should look the same whether it is reached inside a workspace or not.
      */}
      <aside
        style={{ width: SIDEBAR_WIDTH.DEFAULT }}
        className='flex h-full shrink-0 flex-col overflow-hidden bg-[var(--surface-1)] pt-3'
        aria-label={`${SETTINGS_PLANE_CHROME[plane].label} settings navigation`}
      >
        {sidebar}
      </aside>
      <div className='flex min-w-0 flex-1 flex-col'>
        <main className='flex-1 overflow-hidden border-[var(--border)] border-l bg-[var(--bg)]'>
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
  )
}
