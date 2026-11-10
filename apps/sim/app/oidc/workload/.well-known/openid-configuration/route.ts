import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { workloadIdentityDiscoveryResponse } from '@/lib/credentials/workload-identity/responses'

/** OpenID Connect discovery for Sim's workload-identity issuer (keyless cloud credentials). */
export const GET = withRouteHandler(workloadIdentityDiscoveryResponse)
