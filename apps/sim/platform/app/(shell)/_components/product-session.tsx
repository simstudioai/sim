'use client'

import type { ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { DesktopHost } from '@/platform/app/(shell)/_components/desktop/desktop-host'
import { NotificationSession } from '@/platform/app/(shell)/_components/notification-tray/notification-tray'
import { ChatChangesProvider } from '@/platform/app/(shell)/_components/session/chat-changes'
import { ComposerDrafts } from '@/platform/app/(shell)/_components/session/composer-drafts'
import { InterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import { SidebarLayout } from '@/platform/app/(shell)/_components/sidebar/sidebar-layout'

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
