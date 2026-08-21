import { getInheritedByokStatusContract } from '@/lib/api/contracts/byok-keys'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { byokKeyOperations } from '@/lib/api-key/application/operations'
import { readInheritedByokStatus } from '@/lib/api-key/application/organization-byok-keys'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: getInheritedByokStatusContract,
  auth: internalSessionAuth,
  operation: byokKeyOperations.readInheritedStatus,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve the existing authenticated BYOK settings admission policy.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: readInheritedByokStatus,
  present: (result) => result,
})
