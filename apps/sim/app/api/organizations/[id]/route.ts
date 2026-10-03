import {
  getOrganizationContract,
  updateOrganizationContract,
} from '@/lib/api/contracts/organization'
import { organizationRoleSchema } from '@/lib/api/contracts/primitives'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalOrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import {
  organizationOperations,
  organizationSettingsOperations,
} from '@/lib/organizations/application/operations'
import { getOrganization } from '@/lib/organizations/application/reads'
import { updateOrganizationSettings } from '@/lib/organizations/application/settings'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationContract,
  auth: internalSessionAuth,
  operation: organizationOperations.read,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing organization metadata admission',
  }),
  errorPolicy: internalOrganizationErrorPolicy,
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    includeSeats: query.include === 'seats',
  }),
  useCase: getOrganization,
  present: (result) => ({
    success: true,
    data: {
      id: result.id,
      name: result.name,
      slug: result.slug,
      logo: result.logo,
      metadata: result.metadata,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
      ...(result.seats ? { seats: result.seats } : {}),
      ...(result.seatAnalytics ? { seatAnalytics: result.seatAnalytics } : {}),
    },
    userRole: organizationRoleSchema.parse(result.role),
    hasAdminAccess: result.hasAdminAccess,
  }),
})

export const PUT = defineInternalJsonRoute({
  contract: updateOrganizationContract,
  auth: internalSessionAuth,
  operation: organizationSettingsOperations.update,
  rateLimit: internalRateLimits.none({ reason: 'Authenticated organization administrator update' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, patch: body }),
  useCase: updateOrganizationSettings,
  present: (data) => ({
    success: true,
    message: 'Organization updated successfully',
    data: { ...data },
  }),
})
