import { getOAuthProviderMetadataResponse } from '@/lib/auth/oauth-provider-metadata'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/** Better Auth's issuer-prefixed RFC 8414 compatibility location. */
export const GET = withRouteHandler(getOAuthProviderMetadataResponse)
