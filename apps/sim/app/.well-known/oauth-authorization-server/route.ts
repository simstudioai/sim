import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { isOAuthProviderEnabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/**
 * RFC 8414 authorization-server metadata at the origin root. The plugin serves
 * the same document under `/api/auth/.well-known/`; this route exists so a
 * client that only knows Sim's origin can discover the endpoints, and so the
 * Sim CLI can probe one URL to learn whether the provider is on before
 * choosing a login flow. Deliberately 404 rather than an empty document when
 * it is off: "no authorization server here" is the answer.
 *
 * Note the issuer this document names is `<origin>/api/auth`, which is where
 * Better Auth mounts the provider — so a client following RFC 8414 §3.1 to the
 * letter would look under `/.well-known/oauth-authorization-server/api/auth`.
 * This copy is the probe; that path is served by the plugin.
 */
/** Metadata changes only on deploy, and a client re-reads it per connection. */
const DISCOVERY_CACHE_SECONDS = 300

/**
 * Readable from any origin, like every other authorization-server metadata
 * document. It is served from the origin root rather than under `/api/`, which
 * is the only path the proxy's CORS layer covers, so the header is set here.
 */
const DISCOVERY_HEADERS = {
  'Cache-Control': `public, max-age=${DISCOVERY_CACHE_SECONDS}`,
  'Access-Control-Allow-Origin': '*',
} as const

export const GET = withRouteHandler(async () => {
  if (!isOAuthProviderEnabled) {
    return NextResponse.json({ error: 'OAuth provider is not enabled' }, { status: 404 })
  }
  const metadata = await auth.api.getOAuthServerConfig()
  return NextResponse.json(metadata, { headers: DISCOVERY_HEADERS })
})
