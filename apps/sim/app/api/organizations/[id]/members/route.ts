import {
  listOrganizationMembersContract,
  organizationMemberUsageSchema,
} from '@/lib/api/contracts/organization'
import { organizationRoleSchema } from '@/lib/api/contracts/primitives'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalOrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { organizationOperations } from '@/lib/organizations/application/operations'
import { listOrganizationMembers } from '@/lib/organizations/application/reads'

export const GET = defineInternalJsonRoute({
  contract: listOrganizationMembersContract,
  auth: internalSessionAuth,
  operation: organizationOperations.listMembers,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing organization member-directory behavior.',
  }),
  errorPolicy: internalOrganizationErrorPolicy,
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    limit: query.limit,
    offset: query.offset,
    sortBy: 'name' as const,
    sortOrder: 'asc' as const,
    includeUsage: query.include === 'usage',
  }),
  useCase: listOrganizationMembers,
  present: ({ data, total, userRole, hasAdminAccess }, { input }) => {
    if (total === undefined || input.offset === undefined)
      throw new Error('Internal directory requires offset pagination')
    return {
      success: true,
      data: data.map((row) =>
        organizationMemberUsageSchema.parse({
          ...row,
          role: organizationRoleSchema.parse(row.role),
          createdAt: row.createdAt.toISOString(),
          ...(row.usageLimitUpdatedAt === undefined
            ? {}
            : { usageLimitUpdatedAt: row.usageLimitUpdatedAt?.toISOString() ?? null }),
          ...(row.billingPeriodStart === undefined
            ? {}
            : { billingPeriodStart: row.billingPeriodStart?.toISOString() ?? null }),
          ...(row.billingPeriodEnd === undefined
            ? {}
            : { billingPeriodEnd: row.billingPeriodEnd?.toISOString() ?? null }),
        })
      ),
      total,
      pagination: {
        total,
        limit: input.limit,
        offset: input.offset,
        hasMore: input.offset + data.length < total,
      },
      userRole: organizationRoleSchema.parse(userRole),
      hasAdminAccess,
    }
  },
})
