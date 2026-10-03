import { runDataDrainContract } from '@/lib/api/contracts/data-drains'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { dataDrainOperations } from '@/lib/data-drains/application/operations'
import { authorizeDataDrainOperation, runDataDrain } from '@/lib/data-drains/application/use-cases'
import { dataDrainRouteErrorPolicy } from '@/lib/data-drains/route-policy'

export const POST = defineInternalJsonRoute({
  contract: runDataDrainContract,
  auth: internalSessionAuth,
  operation: dataDrainOperations.run,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves existing organization-admin data-drain route policy',
  }),
  errorPolicy: dataDrainRouteErrorPolicy,
  beforeParse: async ({ principal, params }) => {
    if (typeof params.id === 'string')
      await authorizeDataDrainOperation(principal, dataDrainOperations.run, {
        organizationId: params.id,
      })
  },
  mapInput: ({ params }) => ({ organizationId: params.id, drainId: params.drainId }),
  useCase: runDataDrain,
  present: ({ jobId }) => ({ jobId }),
})
