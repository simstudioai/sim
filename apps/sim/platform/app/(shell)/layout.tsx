import { type ReactNode, Suspense } from 'react'
import { ProductSession } from '@/platform/app/(shell)/_components/product-session'
import { loadShellScenarios } from '@/platform/fixtures'

export default async function Layout({ children }: { children: ReactNode }) {
  const fixtures = await loadShellScenarios()
  return (
    <Suspense fallback={null}>
      <ProductSession fixtures={fixtures}>{children}</ProductSession>
    </Suspense>
  )
}
