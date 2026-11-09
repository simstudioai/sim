import { type ReactNode, Suspense } from 'react'
import { ProductSession } from '@/app/(product)/_components/product-session'
import { FIXTURE_ROUTE_PREFIX, loadShellScenarios } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

/**
 * The one product shell, around every organization and workspace page, so the sidebar never
 * remounts between them. A live session resolves its organization from the request's shell scope.
 */
export async function ProductShell({
  telemetry,
  children,
}: {
  /** Mounted inside a live session's providers; example data has no session to measure. */
  telemetry: ReactNode
  children: ReactNode
}) {
  if (resolvePlatformMode() === 'live') {
    // Loaded only here, so a fixture server never evaluates the data seam.
    const { LiveShell } = await import('@/app/(product)/_components/live-shell/live-shell')
    return <LiveShell telemetry={telemetry}>{children}</LiveShell>
  }
  const fixtures = await loadShellScenarios()
  return (
    <Suspense fallback={null}>
      <ProductSession fixtures={fixtures} routePrefix={FIXTURE_ROUTE_PREFIX}>
        {children}
      </ProductSession>
    </Suspense>
  )
}
