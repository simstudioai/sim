import { getOAuthProviderMetadataResponse } from '@/lib/auth/oauth-provider-metadata'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/** RFC 8414 metadata location derived from Sim's `/api/auth` issuer path. */
export const GET = withRouteHandler(getOAuthProviderMetadataResponse)
