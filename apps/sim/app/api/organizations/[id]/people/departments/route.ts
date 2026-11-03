import { listDepartmentsContract } from '@/lib/api/contracts/people'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listDepartments } from '@/lib/people/application/use-cases'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

function scope(id: string, search?: string) {
  return cursorScopeKey(cursorRoute(listDepartmentsContract, { id }), { search })
}

export const GET = defineInternalJsonRoute({
  contract: listDepartmentsContract,
  operation: listDepartments.operation,
  useCase: listDepartments,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({ bucketName: 'people' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    search: query.search,
    cursorKeys: readSortedCursor(query.cursor, 'department', 'asc', scope(params.id, query.search)),
  }),
  present: ({ data, nextCursorKeys }, { input }) => ({
    departments: data,
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      'department',
      'asc',
      scope(input.organizationId, input.search)
    ),
  }),
})
