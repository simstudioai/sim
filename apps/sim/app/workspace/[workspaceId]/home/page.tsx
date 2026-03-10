import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import { Home } from './home'

export const metadata: Metadata = {
  title: 'Home',
}

interface HomePageProps {
  params: Promise<{
    workspaceId: string
  }>
}

export default async function HomePage({ params }: HomePageProps) {
  const { workspaceId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    redirect('/')
  }

  const hasPermission = await verifyWorkspaceMembership(session.user.id, workspaceId)
  if (!hasPermission) {
    redirect('/')
  }

  return <Home key='home' />
}
