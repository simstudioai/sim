import { resolveBrowserSurface } from '@/lib/api/client-info'

/**
 * The super properties that attribute every browser-side event to the surface
 * the user is on. Registered once at PostHog initialization so client events
 * carry the same `surface` property the server stamps from `X-Sim-Client-Info`,
 * and a single breakdown covers both.
 */
export function surfaceSuperProperties(): { surface: 'web' | 'desktop'; app_version?: string } {
  const { surface, version } = resolveBrowserSurface()
  return version === undefined ? { surface } : { surface, app_version: version }
}
