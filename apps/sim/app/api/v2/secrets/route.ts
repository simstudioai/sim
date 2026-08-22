import { v2ListSecretsContract } from '@/lib/api/contracts/v2/secrets'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { secretOperations } from '@/lib/secrets/application/operations'
import { listSecretsUseCase } from '@/lib/secrets/application/use-cases'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'
import { toV2Secret } from '@/app/api/v2/secrets/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Every param that changes which secrets, in which order, this list returns. */
function secretCursorFilters(query: { workspaceId: string; scope?: string; search?: string }) {
  return cursorScopeKey(cursorRoute(v2ListSecretsContract), {
    workspaceId: query.workspaceId,
    scope: query.scope,
    search: query.search,
  })
}

/** GET /api/v2/secrets — List secret names and metadata without reading their values. */
export const GET = defineV2JsonRoute({
  contract: v2ListSecretsContract,
  operation: secretOperations.list,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    ...query,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      secretCursorFilters(query)
    ),
  }),
  useCase: listSecretsUseCase,
  present: ({ secrets, userId, nextCursorKeys }, { query }) => ({
    data: secrets.map((secret) => toV2Secret(secret, userId)),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      secretCursorFilters(query)
    ),
  }),
})
