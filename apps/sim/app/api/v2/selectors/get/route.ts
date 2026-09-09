import { v2GetSelectorContract } from '@/lib/api/contracts/v2/selectors'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2SelectorErrorPolicy } from '@/lib/selectors/api/error-policy'
import { getSelectorOption } from '@/lib/selectors/application/get-selector-option'
import { selectorOperations } from '@/lib/selectors/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2GetSelectorContract,
  auth: v2ApiKeyAuth,
  operation: selectorOperations.execute,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2SelectorErrorPolicy,
  parseOptions: { maxBodyBytes: 256 * 1024 },
  mapInput: ({ body }) => ({
    selectorKey: body.selectorKey,
    context: body.context,
    scope: { kind: 'workspace' as const, workspaceId: body.workspaceId },
    id: body.id,
  }),
  useCase: getSelectorOption,
  present: (result) => ({ data: result }),
})
