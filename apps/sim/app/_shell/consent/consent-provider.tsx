'use client'

import dynamic from 'next/dynamic'

/**
 * Lazy boundary for the cookie-consent runtime.
 *
 * The runtime is loaded on the client only, and only once this component is
 * rendered — the root layout renders it behind `isHosted`, so a self-hosted
 * deployment never fetches the chunk, never reaches Sim's consent backend, and
 * never sees the banner. Deferring it also keeps the third-party store out of
 * the server render and off the landing page's hydration path; the banner
 * cannot paint before its geo lookup resolves anyway.
 */
const ConsentRuntime = dynamic(
  () => import('@/app/_shell/consent/consent-runtime').then((m) => m.ConsentRuntime),
  { ssr: false }
)

/**
 * Mounts the consent runtime alongside the app rather than wrapping it, so
 * consent state changes can never re-render the page tree. Nothing outside
 * {@link ConsentRuntime} reads consent today; a surface that needs to (a footer
 * "Cookie preferences" link, say) would move the provider above it.
 */
export function ConsentProvider() {
  return <ConsentRuntime />
}
