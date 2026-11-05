import { generateRuntimeCSP } from '@/lib/core/security/csp'

export function isLiveZone(): boolean {
  return process.env.SIM_PLATFORM_FIXTURES !== '1' && Boolean(process.env.SIM_PLATFORM_API_ORIGIN)
}

/** What the main app's proxy sends for its own app surfaces, plus the zone's noindex. */
export function liveSecurityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': generateRuntimeCSP(),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Robots-Tag': 'noindex, nofollow',
  }
}
