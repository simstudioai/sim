'use client'

import type { ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { DesktopHost } from '@/platform/app/(shell)/_components/desktop/desktop-host'
import type { ShellData } from '@/platform/app/(shell)/_components/model'
import { NotificationSession } from '@/platform/app/(shell)/_components/notification-tray/notification-tray'
import { PlatformShell } from '@/platform/app/(shell)/_components/platform-shell/platform-shell'
import { ChatChangesProvider } from '@/platform/app/(shell)/_components/session/chat-changes'
import { ComposerDrafts } from '@/platform/app/(shell)/_components/session/composer-drafts'
import { IntegrationChanges } from '@/platform/app/(shell)/_components/session/integration-changes'
import { InterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import { ProductSurface } from '@/platform/app/(shell)/_components/session/product-surface'
import { SidebarLayout } from '@/platform/app/(shell)/_components/sidebar/sidebar-layout'
import { readAppearance, readScenario } from '@/platform/design-system/navigation'
import type { Scenario } from '@/platform/fixtures'
import { useLiveShellData } from '@/platform/lib/data/shell-context'

interface ProductSessionProps {
  fixtures: Record<Scenario, ShellData> | null
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
  return (
    <InterfacePreferences key={scenario}>
      <DesktopHost />
      <SidebarLayout initialCollapsed={sidebarCollapsed}>
        <NotificationSession>
          <ChatChangesProvider>
            <ComposerDrafts>
              <ProductSurface preference={live?.appearance ?? readAppearance(search.get('theme'))}>
                <IntegrationChanges>
                  <PlatformShell data={live ?? fixtures?.[scenario] ?? null} banner={banner}>
                    {children}
                  </PlatformShell>
                </IntegrationChanges>
              </ProductSurface>
            </ComposerDrafts>
          </ChatChangesProvider>
        </NotificationSession>
      </SidebarLayout>
    </InterfacePreferences>
  )
}
