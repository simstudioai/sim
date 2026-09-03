import { v2CreateSandboxContract, v2ListSandboxesContract } from '@/lib/api/contracts/v2/sandboxes'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { sandboxOperations } from '@/lib/sandboxes/application/operations'
import {
  createWorkspaceSandboxUseCase,
  listWorkspaceSandboxesUseCase,
} from '@/lib/sandboxes/application/use-cases'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'
import { sandboxCollectionErrorPolicy } from '@/app/api/v2/sandboxes/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Every param that changes which sandboxes, in which order, this list returns. */
function sandboxCursorFilters(query: { workspaceId: string; search?: string }) {
  return cursorScopeKey(cursorRoute(v2ListSandboxesContract), {
    workspaceId: query.workspaceId,
    search: query.search,
  })
}

/** GET /api/v2/sandboxes — List sandboxes in a workspace. */
export const GET = defineV2JsonRoute({
  contract: v2ListSandboxesContract,
  operation: sandboxOperations.list,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: sandboxCollectionErrorPolicy,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      sandboxCursorFilters(query)
    ),
  }),
  useCase: listWorkspaceSandboxesUseCase,
  present: ({ sandboxes, nextCursorKeys }, { query }) => ({
    data: sandboxes,
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      sandboxCursorFilters(query)
    ),
  }),
})

/** POST /api/v2/sandboxes — Create a sandbox and schedule its build. */
export const POST = defineV2JsonRoute({
  contract: v2CreateSandboxContract,
  operation: sandboxOperations.create,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: sandboxCollectionErrorPolicy,
  mapInput: ({ body }) => ({ ...body, source: 'api' as const }),
  useCase: createWorkspaceSandboxUseCase,
  present: ({ sandbox }) => ({ data: sandbox }),
})
