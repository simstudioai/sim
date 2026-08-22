import { v2CreateTableViewContract, v2ListTableViewsContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { tableOperations } from '@/lib/table/application/operations'
import { createTableViewUseCase, listTableViewsUseCase } from '@/lib/table/application/views'
import {
  getRequiredUserEmail,
  getUserEmailsByIds,
  requireResolvedUserEmail,
} from '@/lib/users/queries'
import { toApiView } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2ListTableViewsContract,
  operation: tableOperations.listViews,
  useCase: listTableViewsUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, query }) => ({ tableId: params.tableId, workspaceId: query.workspaceId }),
  present: async ({ views, columns }) => {
    const emailByUserId = await getUserEmailsByIds(
      views.flatMap((view) => (view.createdBy ? [view.createdBy] : []))
    )
    return {
      data: views.map((view) =>
        toApiView(
          view,
          view.createdBy ? requireResolvedUserEmail(emailByUserId, view.createdBy) : null,
          columns
        )
      ),
      nextCursor: null,
    }
  },
})

export const POST = defineV2JsonRoute({
  contract: v2CreateTableViewContract,
  operation: tableOperations.createView,
  useCase: createTableViewUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, body }) => ({ tableId: params.tableId, ...body }),
  present: async ({ view, columns }) => ({
    data: toApiView(
      view,
      view.createdBy ? await getRequiredUserEmail(view.createdBy) : null,
      columns
    ),
  }),
})
