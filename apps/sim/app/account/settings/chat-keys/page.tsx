import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getAccountSettingsHref } from '@/components/settings/navigation'
import { getSession } from '@/lib/auth'
import { isHosted } from '@/lib/core/config/env-flags'
import { ChatKeysView } from '@/app/account/settings/chat-keys/chat-keys-view'

export const metadata: Metadata = {
  title: 'Chat keys - Account settings',
}

export default async function AccountChatKeysPage() {
  const session = await getSession()
  if (!session?.user) redirect('/login')
  if (!isHosted) redirect(getAccountSettingsHref('general'))

  return (
    <Suspense fallback={null}>
      <ChatKeysView />
    </Suspense>
  )
}
