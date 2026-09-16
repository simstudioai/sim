import {
  deleteDataDrainContract,
  getDataDrainContract,
  updateDataDrainContract,
} from '@/lib/api/contracts/data-drains'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { dataDrainOperations } from '@/lib/data-drains/application/operations'
import {
  authorizeDataDrainOperation,
  deleteDataDrain,
  getDataDrain,
  updateDataDrain,
} from '@/lib/data-drains/application/use-cases'
import { dataDrainRouteErrorPolicy } from '@/lib/data-drains/route-policy'
import { serializeDrain } from '@/lib/data-drains/serializers'

export const GET = defineInternalJsonRoute({
  contract: getDataDrainContract,
  auth: internalSessionAuth,
  operation: dataDrainOperations.get,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves existing organization-admin data-drain route policy',
  }),
  errorPolicy: dataDrainRouteErrorPolicy,
  beforeParse: async ({ principal, params }) => {
    if (typeof params.id === 'string')
      await authorizeDataDrainOperation(principal, dataDrainOperations.get, {
        organizationId: params.id,
      })
  },
  mapInput: ({ params }) => ({ organizationId: params.id, drainId: params.drainId }),
  useCase: getDataDrain,
  present: (row) => ({ drain: serializeDrain(row) }),
})

export const PUT = defineInternalJsonRoute({
  contract: updateDataDrainContract,
  auth: internalSessionAuth,
  operation: dataDrainOperations.update,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves existing organization-admin data-drain route policy',
  }),
  errorPolicy: dataDrainRouteErrorPolicy,
  beforeParse: async ({ principal, params }) => {
    if (typeof params.id === 'string')
      await authorizeDataDrainOperation(principal, dataDrainOperations.update, {
        organizationId: params.id,
      })
  },
  mapInput: ({ params, body }) => ({ organizationId: params.id, drainId: params.drainId, body }),
  useCase: updateDataDrain,
  present: (row) => ({ drain: serializeDrain(row) }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteDataDrainContract,
  auth: internalSessionAuth,
  operation: dataDrainOperations.delete,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves existing organization-admin data-drain route policy',
  }),
  errorPolicy: dataDrainRouteErrorPolicy,
  beforeParse: async ({ principal, params }) => {
    if (typeof params.id === 'string')
      await authorizeDataDrainOperation(principal, dataDrainOperations.delete, {
        organizationId: params.id,
      })
  },
  mapInput: ({ params }) => ({ organizationId: params.id, drainId: params.drainId }),
  useCase: deleteDataDrain,
  present: () => ({ success: true as const }),
})
