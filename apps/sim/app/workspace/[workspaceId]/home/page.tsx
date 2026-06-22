import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { Home } from './home'
import { HomeFallback } from './home-fallback'

export const metadata: Metadata = {
  title: 'New chat',
}

export default async function HomePage() {
  const session = await getSession()
  return (
    <Suspense fallback={<HomeFallback />}>
      <Home userName={session?.user?.name} userId={session?.user?.id} />
    </Suspense>
  )
}
