/**
 * Whether this server renders Platform's example data instead of live reads. It is a design preview
 * for the development server only and renders with no login, so a production build never serves it,
 * whatever its environment says.
 */
export function isPlatformFixtureServer(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.SIM_PLATFORM_FIXTURES === '1'
}
