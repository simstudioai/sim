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
 * is identical to the self-hosted path - only the env read differs.
 * `<PublicEnvScript>` additionally calls `unstable_noStore()`, which opts the
 * entire app into dynamic rendering; that only pays off for self-hosted Docker
 * images that re-inject env per deploy without a rebuild, so hosted reads the
 * env once here and stays static.
 *
 * `disableNextScript` is load-bearing. Without it, `<EnvScript>` defaults to
 * Next's `<Script strategy='beforeInteractive'>`, which does not assign
 * `window.__ENV` at all - it emits a tag that pushes the assignment onto
 * `self.__next_s`. That queue has exactly one consumer, `appBootstrap`, which
 * reads it once and short-circuits to `hydrate()` when it is empty. The
 * bootstrap chunk's `<script async>` tag sits ~13KB earlier in the document
 * than this tag, so whenever that chunk executes before the parser arrives
 * here, the queue is drained empty, nothing ever drains it again, and
 * `window.__ENV` stays undefined for the entire lifetime of the document -
 * every `getEnv` read empty, until a reload happens to win the race.
 *
 * A plain `<script>` assigns unconditionally when the parser reaches it. When
 * it is reached before the bootstrap chunk runs it lands strictly earlier than
 * the queue drain would have; when it is not, the value still arrives a few
 * milliseconds late instead of never. There is no supported way to place an
 * inline script ahead of the framework's own bootstrap tags - React emits those
 * in the preamble, before any content from the component tree - so the goal is
 * to make losing that race harmless rather than to try to win it.
 */
export function PublicEnvScript() {
  return <EnvScript env={HOSTED_PUBLIC_ENV} disableNextScript />
}
