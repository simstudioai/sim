'use client'

import type { ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { InterfacePreferences } from '@/platform/design-system/components'
import { ChatChangesProvider } from '@/platform/design-system/components/chat-changes'
import { ComposerDrafts } from '@/platform/design-system/components/composer-drafts'
import { DesktopHost } from '@/platform/design-system/components/desktop-host'
import { NotificationSession } from '@/platform/design-system/components/notification-tray'
import { SidebarLayout } from '@/platform/design-system/components/sidebar-layout'

interface ProductSessionProps {
  children: ReactNode
}

export function ProductSession({ children }: ProductSessionProps) {
  const state = useSearchParams().get('state')
  const scenario = state === 'empty' || state === 'stress' ? state : 'full'
  return (
    <InterfacePreferences key={scenario}>
      <DesktopHost />
      <SidebarLayout>
        <NotificationSession>
          <ChatChangesProvider>
            <ComposerDrafts>{children}</ComposerDrafts>
          </ChatChangesProvider>
        </NotificationSession>
      </SidebarLayout>
    </InterfacePreferences>
  )
}
