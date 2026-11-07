'use client'

import type { ReactNode } from 'react'
import { PlatformSurface } from '@sim/emcn-platform/surface/platform-surface'
import { useSearchParams } from 'next/navigation'
import { DesktopHost } from '@/platform/app/(shell)/_components/desktop/desktop-host'
import type { SettingsNavGroup, ShellData } from '@/platform/app/(shell)/_components/model'
import { NotificationSession } from '@/platform/app/(shell)/_components/notification-tray/notification-tray'
import { PlatformShell } from '@/platform/app/(shell)/_components/platform-shell/platform-shell'
import { ChatChangesProvider } from '@/platform/app/(shell)/_components/session/chat-changes'
import { ComposerDrafts } from '@/platform/app/(shell)/_components/session/composer-drafts'
import { ComposerSession } from '@/platform/app/(shell)/_components/session/composer-host'
import { IntegrationCenterChanges } from '@/platform/app/(shell)/_components/session/integration-center-changes'
import { IntegrationChanges } from '@/platform/app/(shell)/_components/session/integration-changes'
import { InterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import { SidebarLayout } from '@/platform/app/(shell)/_components/sidebar/sidebar-layout'
import type { Scenario } from '@/platform/fixtures'
import { useLiveShellData } from '@/platform/lib/data/shell-context'
import {
  type PreviewPlan,
  readAppearance,
  readPreviewPlan,
  readScenario,
} from '@/platform/lib/navigation'

interface ProductSessionProps {
  fixtures: Record<
    Scenario,
    ShellData & { settingsByPlan: Record<PreviewPlan, SettingsNavGroup[]> }
  > | null
  /** Above the shell, inside the theme: session states only a live session has. */
  banner?: ReactNode
  /** The `sidebar_collapsed` cookie the server read. Absent means collapse is session state. */
  sidebarCollapsed?: boolean
  children: ReactNode
}

export function ProductSession({
  children,
  fixtures,
  banner,
  sidebarCollapsed,
}: ProductSessionProps) {
  const search = useSearchParams()
  const scenario = readScenario(search.get('state'))
  const live = useLiveShellData()
  const fixture = fixtures?.[scenario]
  const data =
    live ??
    (fixture && {
      ...fixture,
      settingsNavigation: fixture.settingsByPlan[readPreviewPlan(search.get('plan'))],
    }) ??
    null
  return (
    <InterfacePreferences key={scenario}>
      <DesktopHost />
      <SidebarLayout initialCollapsed={sidebarCollapsed}>
        <NotificationSession>
          <ChatChangesProvider>
            <ComposerDrafts>
              <ComposerSession>
                <PlatformSurface theme={live?.appearance ?? readAppearance(search.get('theme'))}>
                  <IntegrationChanges>
                    <IntegrationCenterChanges enabled={Boolean(fixture) && !live}>
                      <PlatformShell data={data} banner={banner}>
                        {children}
                      </PlatformShell>
                    </IntegrationCenterChanges>
                  </IntegrationChanges>
                </PlatformSurface>
              </ComposerSession>
            </ComposerDrafts>
          </ChatChangesProvider>
        </NotificationSession>
      </SidebarLayout>
    </InterfacePreferences>
  )
}
