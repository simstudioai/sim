import {
  deleteOrganizationByokKeyContract,
  listOrganizationByokKeysContract,
  upsertOrganizationByokKeyContract,
} from '@/lib/api/contracts/byok-keys'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { byokKeyOperations } from '@/lib/api-key/application/operations'
import {
  deleteOrganizationByokKey,
  listOrganizationByokKeys,
  saveOrganizationByokKey,
} from '@/lib/api-key/application/organization-byok-keys'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const rateLimit = internalRateLimits.none({
  reason: 'Preserve the existing authenticated BYOK settings admission policy.',
})

export const GET = defineInternalJsonRoute({
  contract: listOrganizationByokKeysContract,
  auth: internalSessionAuth,
  operation: byokKeyOperations.listOrganization,
  rateLimit,
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: listOrganizationByokKeys,
  present: ({ keys, entitled }) => ({
    keys: keys.map((key) => ({
      ...key,
      createdAt: key.createdAt.toISOString(),
      updatedAt: key.updatedAt.toISOString(),
    })),
    entitled,
  }),
})

export const POST = defineInternalJsonRoute({
  contract: upsertOrganizationByokKeyContract,
  auth: internalSessionAuth,
  operation: byokKeyOperations.saveOrganization,
  rateLimit,
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  useCase: saveOrganizationByokKey,
  present: ({ key }) => ({
    success: true as const,
    key: {
      id: key.id,
      providerId: key.providerId,
      name: key.name,
      maskedKey: key.maskedKey,
      createdAt: key.createdAt?.toISOString(),
      updatedAt: key.updatedAt?.toISOString(),
    },
  }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteOrganizationByokKeyContract,
  auth: internalSessionAuth,
  operation: byokKeyOperations.deleteOrganization,
  rateLimit,
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  useCase: deleteOrganizationByokKey,
  present: () => ({ success: true as const }),
})
