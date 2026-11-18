import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { workloadIdentityJwksResponse } from '@/lib/credentials/workload-identity/responses'

/** Public signing keys for Sim's workload-identity issuer. */
export const GET = withRouteHandler(workloadIdentityJwksResponse)
