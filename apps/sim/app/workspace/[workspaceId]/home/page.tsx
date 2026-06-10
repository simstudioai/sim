import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { Home } from './home'

export const metadata: Metadata = {
  title: 'New chat',
}

interface HomePageProps {
  searchParams: Promise<{ resource?: string }>
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const [session, { resource }] = await Promise.all([getSession(), searchParams])
  return (
    <Home
      userName={session?.user?.name}
      userId={session?.user?.id}
      initialResourceId={resource ?? null}
    />
  )
}
