import { listDepartmentsContract } from '@/lib/api/contracts/people'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listDepartments } from '@/lib/people/application/use-cases'

export const GET = defineInternalJsonRoute({
  contract: listDepartmentsContract,
  operation: listDepartments.operation,
  useCase: listDepartments,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({ bucketName: 'people' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
  mapInput: ({ params }) => ({ organizationId: params.id }),
  present: (departments) => ({ departments }),
})
