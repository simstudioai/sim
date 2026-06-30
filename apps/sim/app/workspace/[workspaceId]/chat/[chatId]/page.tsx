import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
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
