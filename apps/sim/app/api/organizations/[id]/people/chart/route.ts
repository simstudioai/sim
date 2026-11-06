import { getPeopleChartContract } from '@/lib/api/contracts/people'
import { presentPerson } from '@/lib/api/server/people-presenters'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getPeopleChart } from '@/lib/people/application/use-cases'

export const GET = defineInternalJsonRoute({
  contract: getPeopleChartContract,
  operation: getPeopleChart.operation,
  useCase: getPeopleChart,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({ bucketName: 'people' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
  mapInput: ({ params, query }) => ({ organizationId: params.id, ...query }),
  present: ({ person, ...branch }) => ({ ...branch, person: presentPerson(person) }),
})
