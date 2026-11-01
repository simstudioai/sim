import { listPeopleContract } from '@/lib/api/contracts/people'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { presentPerson } from '@/lib/api/server/people-presenters'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listPeople } from '@/lib/people/application/use-cases'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

/** A cursor resumes only the list it came from: the same organization, search, and department. */
function cursorScope(id: string, search: string | undefined, department: string | undefined) {
  return cursorScopeKey(cursorRoute(listPeopleContract, { id }), { search, department })
}

export const GET = defineInternalJsonRoute({
  contract: listPeopleContract,
  operation: listPeople.operation,
  useCase: listPeople,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({ bucketName: 'people' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    search: query.search,
    department: query.department,
    cursorKeys: readSortedCursor(
      query.cursor,
      'name',
      'asc',
      cursorScope(params.id, query.search, query.department)
    ),
  }),
  present: ({ data, nextCursorKeys }, { input }) => ({
    people: data.map(presentPerson),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      'name',
      'asc',
      cursorScope(input.organizationId, input.search, input.department)
    ),
  }),
})
