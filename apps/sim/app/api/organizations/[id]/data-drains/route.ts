import { createDataDrainContract, listDataDrainsContract } from '@/lib/api/contracts/data-drains'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { dataDrainOperations } from '@/lib/data-drains/application/operations'
import {
  authorizeDataDrainOperation,
  createDataDrain,
  listDataDrains,
} from '@/lib/data-drains/application/use-cases'
import { dataDrainRouteErrorPolicy } from '@/lib/data-drains/route-policy'
import { serializeDrain } from '@/lib/data-drains/serializers'

export const GET = defineInternalJsonRoute({
  contract: listDataDrainsContract,
  auth: internalSessionAuth,
  operation: dataDrainOperations.list,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves existing organization-admin data-drain route policy',
  }),
  errorPolicy: dataDrainRouteErrorPolicy,
  beforeParse: async ({ principal, params }) => {
    if (typeof params.id === 'string')
      await authorizeDataDrainOperation(principal, dataDrainOperations.list, {
        organizationId: params.id,
      })
  },
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: listDataDrains,
  present: (rows) => ({ drains: rows.map(serializeDrain) }),
})

export const POST = defineInternalJsonRoute({
  contract: createDataDrainContract,
  auth: internalSessionAuth,
  operation: dataDrainOperations.create,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves existing organization-admin data-drain route policy',
  }),
  errorPolicy: dataDrainRouteErrorPolicy,
  beforeParse: async ({ principal, params }) => {
    if (typeof params.id === 'string')
      await authorizeDataDrainOperation(principal, dataDrainOperations.create, {
        organizationId: params.id,
      })
  },
  mapInput: ({ params, body }) => ({ organizationId: params.id, body }),
  useCase: createDataDrain,
  present: (row) => ({ drain: serializeDrain(row) }),
})
