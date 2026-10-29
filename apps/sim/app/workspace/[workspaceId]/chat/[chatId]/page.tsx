import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { isChatEnabled } from '@/lib/core/config/env-flags'
import { Home } from '@/app/workspace/[workspaceId]/home/home'
import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'

export const metadata: Metadata = {
  title: 'Chat',
}

interface ChatPageProps {
  params: Promise<{
    workspaceId: string
    chatId: string
  }>
}

export default async function ChatPage({ params }: ChatPageProps) {
  // The layout 404s too, but pages and layouts resolve concurrently — without this
  // the page still renders on its way out.
  if (!isChatEnabled) {
    notFound()
  }

  const [{ chatId }, session] = await Promise.all([params, getSession()])
  return (
    <Suspense fallback={<HomeFallback />}>
      <Home
        key={chatId}
        chatId={chatId}
        userName={session?.user?.name}
        userId={session?.user?.id}
      />
    </Suspense>
  )
}
