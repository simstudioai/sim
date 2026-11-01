import { getPersonContract, updatePersonContract } from '@/lib/api/contracts/people'
import { presentPerson } from '@/lib/api/server/people-presenters'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getPerson, updatePerson } from '@/lib/people/application/use-cases'

const policy = {
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({ bucketName: 'people' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
}

export const GET = defineInternalJsonRoute({
  ...policy,
  contract: getPersonContract,
  operation: getPerson.operation,
  useCase: getPerson,
  mapInput: ({ params }) => ({ organizationId: params.id, memberId: params.memberId }),
  present: ({ person, chain, reports }) => ({ person: presentPerson(person), chain, reports }),
})

export const PUT = defineInternalJsonRoute({
  ...policy,
  contract: updatePersonContract,
  operation: updatePerson.operation,
  useCase: updatePerson,
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    memberId: params.memberId,
    ...body,
  }),
  present: (person) => ({ person: presentPerson(person) }),
})
