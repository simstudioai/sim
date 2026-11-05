import { type ReactNode, Suspense } from 'react'
import { ProductSession } from '@/platform/app/(shell)/_components/product-session'
import { loadShellScenarios } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export default async function Layout({ children }: { children: ReactNode }) {
  if (resolvePlatformMode() === 'live') {
    // Loaded only here, so a fixture server never evaluates the data seam.
    const { LiveShell } = await import('@/platform/app/(shell)/_components/live-shell/live-shell')
    return <LiveShell>{children}</LiveShell>
  }
  const fixtures = await loadShellScenarios()
  return (
    <Suspense fallback={null}>
      <ProductSession fixtures={fixtures}>{children}</ProductSession>
    </Suspense>
  )
}
