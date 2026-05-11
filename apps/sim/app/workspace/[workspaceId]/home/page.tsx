import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Home } from './home'

export const metadata: Metadata = {
  title: 'Home',
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  )
}
