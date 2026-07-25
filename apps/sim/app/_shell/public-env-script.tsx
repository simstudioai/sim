import { PUBLIC_ENV_KEY } from 'next-runtime-env'

/**
 * `NEXT_PUBLIC_*` values, captured once at module load (build time / server
 * start) rather than read per-request - correct on the hosted deployment,
 * where a build's env never changes between requests. Filter matches
 * `next-runtime-env`'s own `getPublicEnv()` exactly.
 */
const HOSTED_PUBLIC_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => /^NEXT_PUBLIC_/i.test(key))
)

/**
 * Static, build-time equivalent of `next-runtime-env`'s `<PublicEnvScript>`
 * for the hosted deployment. It populates `window[PUBLIC_ENV_KEY]` with the
 * exact same shape `getEnv()` (`lib/core/config/env.ts`) reads client-side,
 * but without `next-runtime-env`'s unconditional `unstable_noStore()` call -
 * that call opts the entire app into dynamic rendering, which only pays off
 * for self-hosted Docker images that re-inject env per deploy without a
 * rebuild. On hosted, env is fixed per build, so this is safe to render
 * statically alongside the marketing pages' `revalidate`.
 *
 * Escapes `<` in the serialized JSON so an env value containing `</script>`
 * can't close this tag early and inject markup into every hosted page.
 */
export function PublicEnvScript() {
  const serialized = JSON.stringify(HOSTED_PUBLIC_ENV).replace(/</g, '\\u003c')
  return (
    <script
      id='public-env'
      dangerouslySetInnerHTML={{
        __html: `window['${PUBLIC_ENV_KEY}'] = ${serialized}`,
      }}
    />
  )
}
