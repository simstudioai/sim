import { v2ExecuteToolContract } from '@/lib/api/contracts/v2/catalog'
import {
  defineV2JsonRoute,
  type V2ErrorPolicy,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import {
  executeToolForCaller,
  ToolUsageLimitExceededError,
} from '@/lib/tool-execution/application/execute-tool'
import { toolExecutionOperations } from '@/lib/tool-execution/application/operations'
import { catalogErrorPolicy } from '@/app/api/v2/lib/catalog'
import { v2Error } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** {@link catalogErrorPolicy} plus the `402` a hosted-key call over its usage limit raises. */
const executeToolErrorPolicy = {
  render(error) {
    if (error instanceof ToolUsageLimitExceededError) {
      return v2Error('USAGE_LIMIT_EXCEEDED', error.message)
    }
    return catalogErrorPolicy.render(error)
  },
} satisfies V2ErrorPolicy

/**
 * POST /api/v2/tools/{toolId}/execute — Run one built-in tool.
 *
 * The verb `GET /api/v2/tools/{toolId}` describes: it publishes the parameters,
 * this supplies them. A tool that runs and refuses answers `200` with
 * `status: "failed"`, the way a failed workflow run does, so the error envelope
 * stays reserved for failures of this API rather than of the third party.
 */
export const POST = defineV2JsonRoute({
  contract: v2ExecuteToolContract,
  operation: toolExecutionOperations.execute,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: executeToolErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: body.workspaceId,
    toolId: params.toolId,
    input: body.input,
    credentialId: body.credentialId,
    timeoutSeconds: body.timeoutSeconds,
  }),
  useCase: executeToolForCaller,
  present: ({ toolId, status, output, error }) => ({
    data: { toolId, status, output, error },
  }),
})
