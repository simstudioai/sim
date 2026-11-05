import { connection } from 'next/server'
import { readPublicEnv } from '@/lib/core/config/public-env'

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
 * Serialize embedded JSON defensively so a public value cannot terminate the
 * inline script. JSON's two JavaScript line separators are escaped as well for
 * engines that still parse them as source boundaries.
 */
export function serializePublicEnv(env: Record<string, string | undefined>): string {
  return JSON.stringify(env)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

interface EnvScriptProps {
  env: Record<string, string | undefined>
}

/** Assigns the public environment through a parser-blocking inline script. */
function EnvScript({ env }: EnvScriptProps) {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `window['__ENV'] = ${serializePublicEnv(env)}`,
      }}
    />
  )
}

/**
 * Hosted public environment transport. Hosted secrets are present before the
 * server module loads and remain fixed for the process lifetime, so this path
 * keeps the root layout statically renderable.
 *
 * A plain `<script>` assigns unconditionally when the parser reaches it, so a
 * lost race costs milliseconds instead of the session. It does not make the
 * assignment win the race, though: draining that queue was also the only thing
 * sequencing the assignment ahead of `hydrate()`, and with the queue empty
 * `appBootstrap` hydrates synchronously. `publicEnvHtmlAttributes` is what
 * closes the remaining window - this tag stays because `window.__ENV` is the
 * documented global, and it is what `getEnv` reads first.
 */
export function PublicEnvScript() {
  return <EnvScript env={HOSTED_PUBLIC_ENV} />
}

/**
 * Self-hosted public environment transport. `connection()` keeps the route
 * dynamic so an image can receive a different `NEXT_PUBLIC_*` snapshot each
 * time it starts without rebuilding the application.
 */
export async function RuntimePublicEnvScript() {
  await connection()
  return <EnvScript env={readPublicEnv()} />
}
