'use client'

import type { ReactNode } from 'react'
import { PlatformSurface } from '@sim/emcn-platform/surface/platform-surface'
import { useSearchParams } from 'next/navigation'
import { SuggestionListProvider } from '@/components/file-viewer/rich-markdown-editor/suggestion-list'
import { DesktopHost } from '@/app/(product)/_components/desktop/desktop-host'
import { EditorSuggestions } from '@/app/(product)/_components/editor-suggestions/editor-suggestions'
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
  type Appearance,
  type PreviewPlan,
  readAppearance,
  readPreviewPlan,
  readScenario,
} from '@/platform/lib/navigation'
import { SurfaceScopeProvider } from '@/platform/lib/surface-scope'

interface SessionFrameProps {
  /** `/o/<organizationId>`: what every organization route's path needs in front of it. */
  routePrefix: string
  /** Above the shell, inside the theme: session states only a live session has. */
  banner?: ReactNode
  /** The `sidebar_collapsed` cookie the server read. Absent means collapse is session state. */
  sidebarCollapsed?: boolean
  children: ReactNode
}

interface SessionTreeProps extends SessionFrameProps {
  data: ShellData | null
  theme: Appearance
  /** Example data: its integration changes are session state, and its scenario resets preferences. */
  scenario?: Scenario
}

function SessionTree({
  children,
  routePrefix,
  banner,
  sidebarCollapsed,
  data,
  theme,
  scenario,
}: SessionTreeProps) {
  return (
    <SurfaceScopeProvider routePrefix={routePrefix}>
      <InterfacePreferences key={scenario}>
        <DesktopHost />
        <SidebarLayout initialCollapsed={sidebarCollapsed}>
          <NotificationSession>
            <ChatChangesProvider>
              <ComposerDrafts>
                <ComposerSession>
                  <PlatformSurface theme={theme}>
                    <IntegrationChanges>
                      <IntegrationCenterChanges enabled={scenario !== undefined}>
                        <SuggestionListProvider list={EditorSuggestions}>
                          <PlatformShell data={data} banner={banner}>
                            {children}
                          </PlatformShell>
                        </SuggestionListProvider>
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

/**
 * A fixture build's session: the scenario, plan and theme its URL selects. Only this path reads the
 * query, so a live session never re-renders on a query change.
 */
export function FixtureProductSession({
  fixtures,
  routePrefix,
  banner,
  sidebarCollapsed,
  children,
}: SessionFrameProps & {
  fixtures: Record<
    Scenario,
    ShellData & { settingsByPlan: Record<PreviewPlan, SettingsNavGroup[]> }
  >
}) {
  const search = useSearchParams()
  const scenario = readScenario(search.get('state'))
  const fixture = fixtures[scenario]
  return (
    <SessionTree
      routePrefix={routePrefix}
      banner={banner}
      sidebarCollapsed={sidebarCollapsed}
      data={{
        ...fixture,
        settingsNavigation: fixture.settingsByPlan[readPreviewPlan(search.get('plan'))],
      }}
      theme={readAppearance(search.get('theme'))}
      scenario={scenario}
    >
      {children}
    </SessionTree>
  )
}

/** A live session's shell, over the data `LiveProviders` holds. */
export function ProductSession({
  routePrefix,
  banner,
  sidebarCollapsed,
  children,
}: SessionFrameProps) {
  const live = useLiveShellData()
  return (
    <SessionTree
      routePrefix={routePrefix}
      banner={banner}
      sidebarCollapsed={sidebarCollapsed}
      data={live}
      theme={live?.appearance ?? 'system'}
    >
      {children}
    </SessionTree>
  )
}
