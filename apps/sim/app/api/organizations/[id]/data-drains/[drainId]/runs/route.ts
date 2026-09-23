import { listDataDrainRunsContract } from '@/lib/api/contracts/data-drains'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { dataDrainOperations } from '@/lib/data-drains/application/operations'
import {
  authorizeDataDrainOperation,
  listDataDrainRuns,
} from '@/lib/data-drains/application/use-cases'
import { dataDrainRouteErrorPolicy } from '@/lib/data-drains/route-policy'
import { serializeDrainRun } from '@/lib/data-drains/serializers'

export const GET = defineInternalJsonRoute({
  contract: listDataDrainRunsContract,
  auth: internalSessionAuth,
  operation: dataDrainOperations.runs,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves existing organization-admin data-drain route policy',
  }),
  errorPolicy: dataDrainRouteErrorPolicy,
  beforeParse: async ({ principal, params }) => {
    if (typeof params.id === 'string')
      await authorizeDataDrainOperation(principal, dataDrainOperations.runs, {
        organizationId: params.id,
      })
  },
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    drainId: params.drainId,
    limit: query?.limit,
  }),
  useCase: listDataDrainRuns,
  present: (rows) => ({ runs: rows.map(serializeDrainRun) }),
})
