import { EnvScript } from 'next-runtime-env'

/**
 * `NEXT_PUBLIC_*` values, captured once when this module is first loaded - i.e.
 * at server start on the hosted deployment, where a build's env never changes
 * between requests. Filter matches `next-runtime-env`'s own `getPublicEnv()`
 * exactly.
 *
 * These are deliberately NOT the values Next inlines into the client bundle:
 * the image is built with placeholder `NEXT_PUBLIC_*` values and the real ones
 * are supplied to the container at start, so `window.__ENV` is the only source
 * of truth in the browser.
 */
const HOSTED_PUBLIC_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => /^NEXT_PUBLIC_/i.test(key))
)

/**
 * Static equivalent of `next-runtime-env`'s `<PublicEnvScript>` for the hosted
 * deployment. It renders the library's own `<EnvScript>`, so the emitted markup
 * and its `beforeInteractive` loading strategy are identical to the self-hosted
 * path - only the env read differs. `<PublicEnvScript>` additionally calls
 * `unstable_noStore()`, which opts the entire app into dynamic rendering; that
 * only pays off for self-hosted Docker images that re-inject env per deploy
 * without a rebuild, so hosted reads the env once here and stays static.
 *
 * `beforeInteractive` is load-bearing, not an optimization. A plain `<script>`
 * rendered from the root layout lands at the end of `<head>`, after the ~40
 * `<script async>` chunk tags Next emits at the top of the document; an `async`
 * script runs as soon as its fetch resolves, so on a warm cache a Next chunk
 * can execute - and hydration can begin - before the parser reaches the env
 * tag, leaving `window.__ENV` undefined for the first render.
 * `beforeInteractive` instead queues the script into `self.__next_s`, which
 * Next's `appBootstrap` drains to completion before calling `hydrate()`.
 */
export function PublicEnvScript() {
  return <EnvScript env={HOSTED_PUBLIC_ENV} />
}
