import { PUBLIC_ENV_ATTRIBUTE } from '@/lib/core/config/env'

export function readPublicEnv(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => /^NEXT_PUBLIC_/i.test(key))
  )
}

/**
 * Props to spread onto the `<html>` element so the public env is readable by any
 * client code that can run at all.
 *
 * The script in `app/_shell/public-env-script` is rendered from the component tree and
 * therefore lands at the end of `<head>`, well after the `<script async>` bootstrap tags
 * React emits in the preamble — see {@link PUBLIC_ENV_ATTRIBUTE} for the full ordering
 * argument and why that gap is reachable. `<html>` is the document's first tag,
 * so its attributes are parsed before any script exists to read them.
 *
 * Read fresh rather than from a boot-time snapshot so the one helper serves both
 * deployment modes: self-hosted images re-inject env per deploy without a rebuild. On
 * hosted the two reads are the same values, because nothing mutates `process.env` after
 * boot.
 */
export function publicEnvHtmlAttributes(): Record<string, string> {
  return { [PUBLIC_ENV_ATTRIBUTE]: JSON.stringify(readPublicEnv()) }
}
