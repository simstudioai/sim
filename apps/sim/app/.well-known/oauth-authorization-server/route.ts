import { getOAuthProviderMetadataResponse } from '@/lib/auth/oauth-provider-metadata'
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
 * This copy is the probe; Sim serves the issuer-derived alias from the same
 * response helper so every discovery path stays byte-for-byte equivalent.
 */
export const GET = withRouteHandler(getOAuthProviderMetadataResponse)
