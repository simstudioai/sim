'use client'

import type { ReactNode } from 'react'
import { PlatformSurface } from '@sim/emcn-platform/surface/platform-surface'
import { useSearchParams } from 'next/navigation'
import { DesktopHost } from '@/app/(product)/_components/desktop/desktop-host'
import type { SettingsNavGroup, ShellData } from '@/app/(product)/_components/model'
import { NotificationSession } from '@/app/(product)/_components/notification-tray/notification-tray'
import { PlatformShell } from '@/app/(product)/_components/platform-shell/platform-shell'
import { ChatChangesProvider } from '@/app/(product)/_components/session/chat-changes'
import { ComposerDrafts } from '@/app/(product)/_components/session/composer-drafts'
import { ComposerSession } from '@/app/(product)/_components/session/composer-host'
import { IntegrationCenterChanges } from '@/app/(product)/_components/session/integration-center-changes'
import { IntegrationChanges } from '@/app/(product)/_components/session/integration-changes'
import { InterfacePreferences } from '@/app/(product)/_components/session/interface-preferences'
import { SidebarLayout } from '@/app/(product)/_components/sidebar/sidebar-layout'
import type { Scenario } from '@/platform/fixtures'
import { useLiveShellData } from '@/platform/lib/data/shell-context'
import {
  type PreviewPlan,
  readAppearance,
  readPreviewPlan,
  readScenario,
} from '@/platform/lib/navigation'
import { SurfaceScopeProvider } from '@/platform/lib/surface-scope'

interface ProductSessionProps {
  fixtures: Record<
    Scenario,
    ShellData & { settingsByPlan: Record<PreviewPlan, SettingsNavGroup[]> }
  > | null
  /** `/o/<organizationId>`: what every organization route's path needs in front of it. */
  routePrefix: string
  /** Above the shell, inside the theme: session states only a live session has. */
  banner?: ReactNode
  /** The `sidebar_collapsed` cookie the server read. Absent means collapse is session state. */
  sidebarCollapsed?: boolean
  children: ReactNode
}

export function ProductSession({
  children,
  fixtures,
  routePrefix,
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
    <SurfaceScopeProvider routePrefix={routePrefix}>
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
    </SurfaceScopeProvider>
  )
}
