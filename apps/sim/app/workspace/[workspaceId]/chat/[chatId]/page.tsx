import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { Home } from '@/app/workspace/[workspaceId]/home/home'
import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'
import { resolveTableViewsEnabled } from '@/app/workspace/[workspaceId]/home/resolve-table-views-flag'

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
  const [{ workspaceId, chatId }, session] = await Promise.all([params, getSession()])
  const userId = session?.user?.id
  const tableViewsEnabled = await resolveTableViewsEnabled(workspaceId, userId)
  return (
    <Suspense fallback={<HomeFallback />}>
      <Home
        key={chatId}
        chatId={chatId}
        userName={session?.user?.name}
        userId={userId}
        tableViewsEnabled={tableViewsEnabled}
      />
    </Suspense>
  )
}
