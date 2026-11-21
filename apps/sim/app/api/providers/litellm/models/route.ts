import { type NextRequest, NextResponse } from 'next/server'
import { providerModelsResponseSchema } from '@/lib/api/contracts/providers'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listConfiguredSelfHostedModels } from '@/providers/openai-compat/model-list'
import { filterBlacklistedModels, isProviderBlacklisted } from '@/providers/utils'

/**
 * Lists the models the deployment's LiteLLM server serves, or none when the
 * provider is blacklisted, unconfigured, or unreachable.
 */
export const GET = withRouteHandler(async (_request: NextRequest) => {
  if (isProviderBlacklisted('litellm')) return NextResponse.json({ models: [] })

  const models = await listConfiguredSelfHostedModels(
    'litellm',
    env.LITELLM_BASE_URL,
    env.LITELLM_API_KEY
  )
  return NextResponse.json(
    providerModelsResponseSchema.parse({ models: filterBlacklistedModels(models) })
  )
})
