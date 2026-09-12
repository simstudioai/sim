import { getOrganizationNetworkContract } from '@/lib/api/contracts/organization-network'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  readOrganizationNetwork,
  readOrganizationNetworkOperation,
} from '@/lib/core/network/application/read-organization-network'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationNetworkContract,
  auth: internalSessionAuth,
  operation: readOrganizationNetworkOperation,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-network-read' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: readOrganizationNetwork,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
