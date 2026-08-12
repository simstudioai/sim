import {
  v2CreateCustomToolContract,
  v2ListCustomToolsContract,
} from '@/lib/api/contracts/v2/custom-tools'
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
import { toV2CustomTool } from '@/app/api/v2/custom-tools/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/custom-tools — List custom tools in a workspace. */
export const GET = defineV2JsonRoute({
  contract: v2ListCustomToolsContract,
  operation: customToolOperations.list,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listWorkspaceCustomToolsUseCase,
  present: ({ tools }) => ({ data: tools.map(toV2CustomTool), nextCursor: null }),
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
