import { type ReactNode, Suspense } from 'react'
import { FixtureProductSession } from '@/app/(product)/_components/product-session'

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
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const { FIXTURE_ROUTE_PREFIX, loadShellScenarios } = await import('@/platform/fixtures')
    const fixtures = await loadShellScenarios()
    return (
      <Suspense fallback={null}>
        <FixtureProductSession fixtures={fixtures} routePrefix={FIXTURE_ROUTE_PREFIX}>
          {children}
        </FixtureProductSession>
      </Suspense>
    )
  }
  // Loaded only here, so a fixture build never evaluates the data seam.
  const { LiveShell } = await import('@/app/(product)/_components/live-shell/live-shell')
  return <LiveShell telemetry={telemetry}>{children}</LiveShell>
}
