import {
  v2CreateCustomToolContract,
  v2ListCustomToolsContract,
} from '@/lib/api/contracts/v2/custom-tools'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { customToolOperations } from '@/lib/custom-tools/application/operations'
import {
  createWorkspaceCustomToolUseCase,
  listWorkspaceCustomToolsUseCase,
} from '@/lib/custom-tools/application/use-cases'
import { toV2CustomTool, toV2CustomToolList } from '@/app/api/v2/custom-tools/utils'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Every param that changes which custom tools, in which order, this list returns. */
function customToolCursorFilters(query: { workspaceId: string; search?: string }) {
  return cursorScopeKey(cursorRoute(v2ListCustomToolsContract), {
    workspaceId: query.workspaceId,
    search: query.search,
  })
}

/** GET /api/v2/custom-tools — List custom tools in a workspace. */
export const GET = defineV2JsonRoute({
  contract: v2ListCustomToolsContract,
  operation: customToolOperations.list,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    ...query,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      customToolCursorFilters(query)
    ),
  }),
  useCase: listWorkspaceCustomToolsUseCase,
  present: ({ tools, nextCursorKeys }, { query }) => ({
    data: toV2CustomToolList(tools),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      customToolCursorFilters(query)
    ),
  }),
})

/** POST /api/v2/custom-tools — Create a custom tool. */
export const POST = defineV2JsonRoute({
  contract: v2CreateCustomToolContract,
  operation: customToolOperations.create,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ body }) => ({ ...body, source: 'api' as const }),
  useCase: createWorkspaceCustomToolUseCase,
  present: ({ tool }) => ({ data: toV2CustomTool(tool) }),
})
