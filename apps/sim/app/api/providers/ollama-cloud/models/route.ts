import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { ollamaCloudProviderModelsQuerySchema } from '@/lib/api/contracts/providers'
import { validationErrorResponse } from '@/lib/api/server'
import { authenticateOptionalInternalSession } from '@/lib/api/server/routes'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listProviderModels } from '@/lib/provider-models/application/list-models'
import { isProviderBlacklisted } from '@/providers/utils'

const logger = createLogger('OllamaCloudModelsAPI')

/**
 * Get available Ollama Cloud models.
 *
 * Ollama Cloud is BYOK-only — Sim never supplies a hosted key and never bills
 * usage. Models are listed only when the workspace has stored its own Ollama
 * API key, which is used to authenticate against the cloud `/api/tags` endpoint.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  if (isProviderBlacklisted('ollama-cloud')) {
    logger.info('Ollama Cloud provider is blacklisted, returning empty models')
    return NextResponse.json({ models: [] })
  }

  const queryValidation = ollamaCloudProviderModelsQuerySchema.safeParse({
    workspaceId: request.nextUrl.searchParams.get('workspaceId') ?? undefined,
  })
  if (!queryValidation.success) return validationErrorResponse(queryValidation.error)
  const { workspaceId } = queryValidation.data

  const principal = workspaceId ? await authenticateOptionalInternalSession() : null
  const models = await listProviderModels('ollama-cloud', { principal, workspaceId })
  return NextResponse.json({ models })
})
