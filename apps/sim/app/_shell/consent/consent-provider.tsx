'use client'

import dynamic from 'next/dynamic'

/**
 * The cookie-consent runtime, loaded on the client only and only once this
 * component is rendered — the root layout renders it behind `isHosted`, so a
 * self-hosted deployment never fetches the chunk, never reaches Sim's consent
 * backend, and never sees the banner. Deferring it also keeps the third-party
 * store out of the server render and off the landing page's hydration path; the
 * banner cannot paint before its geo lookup resolves anyway.
 *
 * It mounts alongside the app rather than wrapping it because an `ssr: false`
 * boundary around the tree would disable SSR for every route. Nothing can reach
 * the store through context as a result, which is what
 * `OPEN_CONSENT_PREFERENCES_EVENT` exists for.
 */
export const ConsentProvider = dynamic(
  () => import('@/app/_shell/consent/consent-runtime').then((m) => m.ConsentRuntime),
  { ssr: false }
)
