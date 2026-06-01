import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  ollamaCloudProviderModelsQuerySchema,
  ollamaUpstreamResponseSchema,
  providerModelsResponseSchema,
} from '@/lib/api/contracts/providers'
import { validationErrorResponse } from '@/lib/api/server'
import { getBYOKKey } from '@/lib/api-key/byok'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { filterBlacklistedModels, isProviderBlacklisted } from '@/providers/utils'

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

  let apiKey: string | undefined
  if (workspaceId) {
    const session = await getSession()
    if (session?.user?.id) {
      const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
      if (permission) {
        const byokResult = await getBYOKKey(workspaceId, 'ollama-cloud')
        if (byokResult) {
          apiKey = byokResult.apiKey
        }
      }
    }
  }

  if (!apiKey) {
    logger.info('No Ollama Cloud API key available, returning empty models')
    return NextResponse.json({ models: [] })
  }

  try {
    const response = await fetch('https://ollama.com/api/tags', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      logger.warn('Failed to fetch Ollama Cloud models', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json({ models: [] })
    }

    const data = ollamaUpstreamResponseSchema.parse(await response.json())

    const allModels = data.models.map((model) => `ollama-cloud/${model.name}`)
    const uniqueModels = Array.from(new Set(allModels))
    const models = filterBlacklistedModels(uniqueModels)

    logger.info('Successfully fetched Ollama Cloud models', {
      count: models.length,
      filtered: uniqueModels.length - models.length,
    })

    return NextResponse.json(providerModelsResponseSchema.parse({ models }))
  } catch (error) {
    logger.error('Error fetching Ollama Cloud models', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return NextResponse.json({ models: [] })
  }
})
