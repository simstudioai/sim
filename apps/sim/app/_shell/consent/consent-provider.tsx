'use client'

import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'

/**
 * The cookie-consent runtime, loaded on the client only and only once this
 * component renders it — the root layout renders it behind `isHosted`, so a
 * self-hosted deployment never fetches the chunk, never reaches Sim's consent
 * backend, and never sees the banner. Deferring it also keeps the third-party
 * store out of the server render and off the landing page's hydration path; the
 * banner cannot paint before its geo lookup resolves anyway.
 */
const ConsentRuntime = dynamic(
  () => import('@/app/_shell/consent/consent-runtime').then((m) => m.ConsentRuntime),
  { ssr: false }
)

const WORKSPACE_SEGMENT = 'workspace'

/**
 * Mounts the consent runtime everywhere except the workspace.
 *
 * Inside the product a floating consent card is the wrong surface — a signed-in
 * user manages this from Settings → Privacy, which mounts the same store. The
 * check sits above the `dynamic()` rather than inside the loaded module so the
 * workspace pays neither the chunk nor the consent init request: gating within
 * the module would still have downloaded it, on the surface with the most hard
 * loads.
 *
 * The gap this leaves — a visitor who reaches the workspace with no consent
 * record is not prompted — closes when the analytics scripts move behind
 * consent, since nothing non-essential loads without a record at all.
 */
export function ConsentProvider() {
  const pathname = usePathname()

  if (pathname.split('/')[1] === WORKSPACE_SEGMENT) {
    return null
  }

  return <ConsentRuntime />
}
