import { type ReactNode, Suspense } from 'react'
import { ProductSession } from '@/app/(product)/_components/product-session'
import { loadShellScenarios } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export default async function Layout({ children }: { children: ReactNode }) {
  if (resolvePlatformMode() === 'live') {
    // Loaded only here, so a fixture server never evaluates the data seam.
    const { LiveShell } = await import('@/app/(product)/_components/live-shell/live-shell')
    return <LiveShell>{children}</LiveShell>
  }
  const fixtures = await loadShellScenarios()
  return (
    <Suspense fallback={null}>
      <ProductSession fixtures={fixtures}>{children}</ProductSession>
    </Suspense>
  )
}
