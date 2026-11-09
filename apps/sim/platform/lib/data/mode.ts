import 'server-only'

type PlatformMode = 'fixture' | 'live' | 'none'

/**
 * Where this server's data comes from, read once per request by each server entry. Fixtures win so
 * a design session stays on its examples even with a database in its environment. Live reads run the
 * application's use cases in process, so they need its database. With neither, routes render their
 * empty fixture-off states.
 */
export function resolvePlatformMode(): PlatformMode {
  if (process.env.SIM_PLATFORM_FIXTURES === '1') return 'fixture'
  return process.env.DATABASE_URL ? 'live' : 'none'
}

/**
 * A production zone behind the rewrite serves only live data: fixtures there would show examples to
 * anyone with no login, and with no database its routes render with no gate at all.
 */
export function assertDeployableMode() {
  if (process.env.NODE_ENV !== 'production') return
  if (!process.env.NEXT_PUBLIC_SIM_PLATFORM_BASE_PATH) return
  const mode = resolvePlatformMode()
  if (mode !== 'live') {
    throw new Error(`The Platform zone is behind a base path but its data mode is "${mode}"`)
  }
}
