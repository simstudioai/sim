import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  ollamaUpstreamResponseSchema,
  providerModelsResponseSchema,
} from '@/lib/api/contracts/providers'
import { isHosted } from '@/lib/core/config/env-flags'
import { getOllamaUrl, isOllamaUrlConfigured } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { filterBlacklistedModels, isProviderBlacklisted } from '@/providers/utils'

const logger = createLogger('OllamaModelsAPI')
const OLLAMA_HOST = getOllamaUrl()

/**
 * Get available Ollama models
 */
export const GET = withRouteHandler(async (_request: NextRequest) => {
  if (isProviderBlacklisted('ollama')) {
    logger.info('Ollama provider is blacklisted, returning empty models')
    return NextResponse.json({ models: [] })
  }

  /**
   * Ollama runs alongside the app it serves, so the hosted platform never has one
   * and `OLLAMA_URL`'s loopback default cannot answer there. Skip the probe rather
   * than dial an address known to refuse on every poll.
   *
   * Only the unconfigured default is skipped: an explicit `OLLAMA_URL` states an
   * intent to reach a real server and is still honoured. Self-hosted deployments
   * are untouched either way, including the localhost default that needs no
   * configuration to work.
   */
  if (isHosted && !isOllamaUrlConfigured()) {
    logger.info('Ollama is not available on the hosted platform, returning empty models')
    return NextResponse.json({ models: [] })
  }

  try {
    logger.info('Fetching Ollama models', {
      host: OLLAMA_HOST,
    })

    const response = await fetch(`${OLLAMA_HOST}/api/tags`, {
      headers: {
        'Content-Type': 'application/json',
      },
      next: { revalidate: 60 },
    })

    if (!response.ok) {
      logger.warn('Ollama service is not available', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json({ models: [] })
    }

    const data = ollamaUpstreamResponseSchema.parse(await response.json())
    const allModels = data.models.map((model) => model.name)
    const models = filterBlacklistedModels(allModels)

    logger.info('Successfully fetched Ollama models', {
      count: models.length,
      filtered: allModels.length - models.length,
      models,
    })

    return NextResponse.json(providerModelsResponseSchema.parse({ models }))
  } catch (error) {
    /**
     * Ollama is optional, so a deployment that does not run one refuses the
     * connection on every poll. That is an expected state rather than a failure of
     * this route — the same condition its siblings report when `VLLM_BASE_URL` or
     * `LITELLM_BASE_URL` is absent — and the response is the same empty list a
     * blacklisted provider returns.
     */
    logger.info('Ollama service is not reachable, returning empty models', {
      error: getErrorMessage(error, 'Unknown error'),
      host: OLLAMA_HOST,
    })

    return NextResponse.json({ models: [] })
  }
})
