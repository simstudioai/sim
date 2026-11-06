import { listDepartmentsContract } from '@/lib/api/contracts/people'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { departmentFilterKey } from '@/lib/api/server/people-presenters'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listDepartments } from '@/lib/people/application/use-cases'
import { cursorSortKey, decodeOffsetCursor, encodeOffsetCursor } from '@/app/api/v2/lib/response'

const SORT = cursorSortKey('department', 'asc')

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
    offset: decodeOffsetCursor(query.cursor, SORT, scope(params.id, query.search)),
  }),
  present: ({ data, nextOffset }, { input }) => ({
    departments: data.map((department) => ({
      ...department,
      departmentKey: departmentFilterKey(department.name),
    })),
    nextCursor:
      nextOffset === null
        ? null
        : encodeOffsetCursor(SORT, scope(input.organizationId, input.search), nextOffset),
  }),
})
