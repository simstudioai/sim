import {
  v2DeleteTableViewContract,
  v2GetTableViewContract,
  v2UpdateTableViewContract,
} from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { tableOperations } from '@/lib/table/application/operations'
import {
  deleteTableViewUseCase,
  readTableViewUseCase,
  updateTableViewUseCase,
} from '@/lib/table/application/views'
import { getRequiredUserEmail } from '@/lib/users/queries'
import { toApiView } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function presentView(result: {
  view: Parameters<typeof toApiView>[0]
  columns: Parameters<typeof toApiView>[2]
}) {
  const { view, columns } = result
  return {
    data: toApiView(
      view,
      view.createdBy ? await getRequiredUserEmail(view.createdBy) : null,
      columns
    ),
  }
}

export const GET = defineV2JsonRoute({
  contract: v2GetTableViewContract,
  operation: tableOperations.readView,
  useCase: readTableViewUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, query }) => ({ ...params, workspaceId: query.workspaceId }),
  present: presentView,
})

export const PATCH = defineV2JsonRoute({
  contract: v2UpdateTableViewContract,
  operation: tableOperations.updateView,
  useCase: updateTableViewUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  present: presentView,
})

export const DELETE = defineV2JsonRoute({
  contract: v2DeleteTableViewContract,
  operation: tableOperations.deleteView,
  useCase: deleteTableViewUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, query }) => ({ ...params, workspaceId: query.workspaceId }),
  present: ({ viewId }) => ({ data: { id: viewId, deleted: true as const } }),
})
