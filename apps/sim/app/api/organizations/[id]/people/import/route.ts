import { importPeopleContract } from '@/lib/api/contracts/people'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { importPeople } from '@/lib/people/application/use-cases'

export const POST = defineInternalJsonRoute({
  contract: importPeopleContract,
  operation: importPeople.operation,
  useCase: importPeople,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({ bucketName: 'people-import' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  present: (result) => result,
})
