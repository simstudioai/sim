import { testDataDrainContract } from '@/lib/api/contracts/data-drains'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { dataDrainOperations } from '@/lib/data-drains/application/operations'
import { authorizeDataDrainOperation, testDataDrain } from '@/lib/data-drains/application/use-cases'
import { dataDrainRouteErrorPolicy } from '@/lib/data-drains/route-policy'

export const POST = defineInternalJsonRoute({
  contract: testDataDrainContract,
  auth: internalSessionAuth,
  operation: dataDrainOperations.test,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves existing organization-admin data-drain route policy',
  }),
  errorPolicy: dataDrainRouteErrorPolicy,
  beforeParse: async ({ principal, params }) => {
    if (typeof params.id === 'string')
      await authorizeDataDrainOperation(principal, dataDrainOperations.test, {
        organizationId: params.id,
      })
  },
  mapInput: ({ params }) => ({ organizationId: params.id, drainId: params.drainId }),
  useCase: testDataDrain,
  present: (result) => {
    if (!result.ok) throw new OrchestrationError('validation', result.error)
    return { ok: true as const }
  },
})
