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
import { MalformedCustomToolRowError, toV2CustomTool } from '@/app/api/v2/custom-tools/utils'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NOT_FOUND_MESSAGE = 'Custom tool not found'

/**
 * Conceals cross-tenant denials, and answers a row that cannot be projected
 * onto the contract with the same `404` — so this surface and the list, which
 * omits such a row, tell one caller one story. See {@link toV2CustomTool}.
 */
const customToolResourceErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: NOT_FOUND_MESSAGE,
  render: (error) =>
    error instanceof MalformedCustomToolRowError
      ? v2Error('NOT_FOUND', NOT_FOUND_MESSAGE)
      : v2CaughtOrchestrationError(error),
})

/** GET /api/v2/custom-tools/[customToolId] — Fetch a single custom tool. */
export const GET = defineV2JsonRoute({
  contract: v2GetCustomToolContract,
  operation: customToolOperations.read,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: customToolResourceErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: query.workspaceId,
    toolId: params.customToolId,
  }),
  useCase: getWorkspaceCustomToolUseCase,
  present: ({ tool }) => ({ data: toV2CustomTool(tool) }),
})

/** PATCH /api/v2/custom-tools/[customToolId] — Update a custom tool. */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateCustomToolContract,
  operation: customToolOperations.update,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: customToolResourceErrorPolicy,
  mapInput: ({ params, body }) => ({
    ...body,
    toolId: params.customToolId,
    source: 'api' as const,
  }),
  useCase: updateWorkspaceCustomToolUseCase,
  present: ({ tool }) => ({ data: toV2CustomTool(tool) }),
})

/** DELETE /api/v2/custom-tools/[customToolId] — Delete a custom tool. */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteCustomToolContract,
  operation: customToolOperations.delete,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: customToolResourceErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: query.workspaceId,
    toolId: params.customToolId,
    source: 'api' as const,
  }),
  useCase: deleteWorkspaceCustomToolUseCase,
  present: ({ tool }) => ({ data: { id: tool.id, deleted: true as const } }),
})
