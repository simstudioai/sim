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

interface ProductSessionProps {
  fixtures: Record<Scenario, ShellData> | null
  children: ReactNode
}

export function ProductSession({ children, fixtures }: ProductSessionProps) {
  const search = useSearchParams()
  const scenario = readScenario(search.get('state'))
  return (
    <InterfacePreferences key={scenario}>
      <DesktopHost />
      <SidebarLayout>
        <NotificationSession>
          <ChatChangesProvider>
            <ComposerDrafts>
              <ProductSurface preference={readAppearance(search.get('theme'))}>
                <IntegrationChanges key={search.get('role') === 'member' ? 'member' : 'admin'}>
                  <PlatformShell data={fixtures?.[scenario] ?? null}>{children}</PlatformShell>
                </IntegrationChanges>
              </ProductSurface>
            </ComposerDrafts>
          </ChatChangesProvider>
        </NotificationSession>
      </SidebarLayout>
    </InterfacePreferences>
  )
}
