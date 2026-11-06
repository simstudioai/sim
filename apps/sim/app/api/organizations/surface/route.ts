import { getOrganizationSurfaceContract } from '@/lib/api/contracts/organization'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalOrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { organizationOperations } from '@/lib/organizations/application/operations'
import { readOrganizationSurface } from '@/lib/organizations/application/surface'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationSurfaceContract,
  auth: internalSessionAuth,
  operation: organizationOperations.readSurface,
  rateLimit: internalRateLimits.none({
    reason:
      'Read per Platform server render, as the legacy organization layout reads it per render',
  }),
  errorPolicy: internalOrganizationErrorPolicy,
  mapInput: () => ({}),
  useCase: readOrganizationSurface,
})
