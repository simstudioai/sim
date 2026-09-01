import { EnvScript } from 'next-runtime-env'
import { PUBLIC_ENV_ATTRIBUTE } from '@/lib/core/config/env'

/**
 * Every `NEXT_PUBLIC_*` value currently in `process.env`. Filter matches
 * `next-runtime-env`'s own `getPublicEnv()` exactly.
 */
function readPublicEnv(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => /^NEXT_PUBLIC_/i.test(key))
  )
}

/**
 * `NEXT_PUBLIC_*` values, captured once when this module is first loaded - i.e.
 * at server start on the hosted deployment, where a build's env never changes
 * between requests (`bootstrap.ts` awaits the runtime secret before importing
 * the server, so `process.env` is complete before any module evaluates).
 *
 * These are deliberately NOT the values Next inlines into the client bundle:
 * the image is built with placeholder `NEXT_PUBLIC_*` values and the real ones
 * are supplied to the container at start, so the browser has no compiled-in
 * copy to fall back on.
 */
const HOSTED_PUBLIC_ENV = readPublicEnv()

/**
 * Props to spread onto the `<html>` element so the public env is readable by any
 * client code that can run at all.
 *
 * The script below is rendered from the component tree and therefore lands at
 * the end of `<head>`, well after the `<script async>` bootstrap tags React
 * emits in the preamble — see {@link PUBLIC_ENV_ATTRIBUTE} for the full ordering
 * argument and why that gap is reachable. `<html>` is the document's first tag,
 * so its attributes are parsed before any script exists to read them.
 *
 * Read fresh rather than from {@link HOSTED_PUBLIC_ENV} so the one helper serves
 * both deployment modes: self-hosted images re-inject env per deploy without a
 * rebuild, and `next-runtime-env`'s script reads `process.env` per request for
 * exactly that reason. On hosted the two reads are the same values, because
 * nothing mutates `process.env` after boot.
 */
export function publicEnvHtmlAttributes(): Record<string, string> {
  return { [PUBLIC_ENV_ATTRIBUTE]: JSON.stringify(readPublicEnv()) }
}

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
 * A plain `<script>` assigns unconditionally when the parser reaches it, so a
 * lost race costs milliseconds instead of the session. It does not make the
 * assignment win the race, though: draining that queue was also the only thing
 * sequencing the assignment ahead of `hydrate()`, and with the queue empty
 * `appBootstrap` hydrates synchronously. {@link publicEnvHtmlAttributes} is what
 * closes the remaining window - this tag stays because `window.__ENV` is the
 * documented global, and it is what `getEnv` reads first.
 */
export function PublicEnvScript() {
  return <EnvScript env={HOSTED_PUBLIC_ENV} disableNextScript />
}
