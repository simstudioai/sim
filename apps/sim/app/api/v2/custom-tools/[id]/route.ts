import {
  v2DeleteCustomToolContract,
  v2GetCustomToolContract,
  v2UpdateCustomToolContract,
} from '@/lib/api/contracts/v2/custom-tools'
import {
  createV2ResourceConcealmentPolicy,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { customToolOperations } from '@/lib/custom-tools/application/operations'
import {
  deleteWorkspaceCustomToolUseCase,
  getWorkspaceCustomToolUseCase,
  updateWorkspaceCustomToolUseCase,
} from '@/lib/custom-tools/application/use-cases'
import { toV2CustomTool } from '@/app/api/v2/custom-tools/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const customToolResourceErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Custom tool not found',
})

/** GET /api/v2/custom-tools/[id] — Fetch a single custom tool. */
export const GET = defineV2JsonRoute({
  contract: v2GetCustomToolContract,
  operation: customToolOperations.read,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: customToolResourceErrorPolicy,
  mapInput: ({ params, query }) => ({ workspaceId: query.workspaceId, toolId: params.id }),
  useCase: getWorkspaceCustomToolUseCase,
  present: ({ tool }) => ({ data: toV2CustomTool(tool) }),
})

/** PATCH /api/v2/custom-tools/[id] — Update a custom tool. */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateCustomToolContract,
  operation: customToolOperations.update,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: customToolResourceErrorPolicy,
  mapInput: ({ params, body }) => ({
    ...body,
    toolId: params.id,
    source: 'api' as const,
  }),
  useCase: updateWorkspaceCustomToolUseCase,
  present: ({ tool }) => ({ data: toV2CustomTool(tool) }),
})

/** DELETE /api/v2/custom-tools/[id] — Delete a custom tool. */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteCustomToolContract,
  operation: customToolOperations.delete,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: customToolResourceErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: query.workspaceId,
    toolId: params.id,
    source: 'api' as const,
  }),
  useCase: deleteWorkspaceCustomToolUseCase,
  present: ({ tool }) => ({ data: { id: tool.id, deleted: true as const } }),
})
