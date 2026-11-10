'use client'

import type { ComponentType, ReactNode } from 'react'
import { PlatformSurface } from '@sim/emcn-platform/surface/platform-surface'
import { SuggestionListProvider } from '@/components/file-viewer/rich-markdown-editor/suggestion-list'
import { DesktopHost } from '@/app/(product)/_components/desktop/desktop-host'
import { EditorSuggestions } from '@/app/(product)/_components/editor-suggestions/editor-suggestions'
import { NotificationSession } from '@/app/(product)/_components/notification-tray/notification-tray'
import { PlatformShell } from '@/app/(product)/_components/platform-shell/platform-shell'
import { ChatChangesProvider } from '@/app/(product)/_components/session/chat-changes'
import { ComposerDrafts } from '@/app/(product)/_components/session/composer-drafts'
import { ComposerSession } from '@/app/(product)/_components/session/composer-host'
import { InterfacePreferences } from '@/app/(product)/_components/session/interface-preferences'
import { SidebarLayout } from '@/app/(product)/_components/sidebar/sidebar-layout'
import type { Scenario } from '@/platform/fixtures'
import type { ShellData } from '@/platform/lib/data/models/shell'
import { useLiveShellData } from '@/platform/lib/data/shell-context'
import type { Appearance } from '@/platform/lib/navigation'
import { SurfaceScopeProvider } from '@/platform/lib/surface-scope'

export interface SessionFrameProps {
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
  /** Example data: its scenario resets the session's preferences and edits. */
  scenario?: Scenario
  /**
   * Example data's session edits. They wrap the shell, not the page, because the shell remounts a
   * scrolling page on every navigation.
   */
  Edits?: ComponentType<{ children: ReactNode }>
}

/** The providers and shell every session renders, live or example data. */
export function SessionTree({
  children,
  routePrefix,
  banner,
  sidebarCollapsed,
  data,
  theme,
  scenario,
  Edits,
}: SessionTreeProps) {
  const shell = (
    <PlatformShell data={data} banner={banner}>
      {children}
    </PlatformShell>
  )
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
                    <SuggestionListProvider list={EditorSuggestions}>
                      {Edits ? <Edits>{shell}</Edits> : shell}
                    </SuggestionListProvider>
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
