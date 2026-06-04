import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { Home } from '@/app/workspace/[workspaceId]/home/home'

export const metadata: Metadata = {
  title: 'Chat',
}

interface TaskPageProps {
  params: Promise<{
    workspaceId: string
    taskId: string
  }>
  searchParams: Promise<{ resource?: string }>
}

export default async function TaskPage({ params, searchParams }: TaskPageProps) {
  const [{ taskId }, { resource }, session] = await Promise.all([
    params,
    searchParams,
    getSession(),
  ])
  return (
    <Home
      key={taskId}
      chatId={taskId}
      userName={session?.user?.name}
      userId={session?.user?.id}
      initialResourceId={resource ?? null}
    />
  )
}
