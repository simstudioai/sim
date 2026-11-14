import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  basetenUpstreamResponseSchema,
  fireworksUpstreamResponseSchema,
  ollamaUpstreamResponseSchema,
  providerModelsResponseSchema,
  togetherUpstreamResponseSchema,
} from '@/lib/api/contracts/providers'
import { getBYOKKey } from '@/lib/api-key/byok'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { env } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/env-flags'
import { scopedOutboundFetch } from '@/lib/core/network/outbound-fetch.server'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { providerModelOperations } from '@/lib/provider-models/application/operations'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'
import { filterBlacklistedModels } from '@/providers/utils'

const logger = createLogger('ProviderModelsList')

/** Together's catalog includes non-text models; only chat models work with chat completions. */
const TOGETHER_NON_CHAT_MODEL_TYPES = new Set([
  'image',
  'video',
  'audio',
  'transcribe',
  'embedding',
  'moderation',
  'rerank',
])

interface ModelCatalogSource {
  url: string
  /** Sim's own key, used when the workspace has none; absent for a BYOK-only provider. */
  platformKey(): string | undefined
  /** Upstream body to provider-prefixed model ids. */
  parse(body: unknown): string[]
}

const MODEL_CATALOGS = {
  baseten: {
    url: 'https://inference.baseten.co/v1/models',
    platformKey: () => env.BASETEN_API_KEY,
    parse: (body) =>
      basetenUpstreamResponseSchema.parse(body).data.map((model) => `baseten/${model.id}`),
  },
  fireworks: {
    url: 'https://api.fireworks.ai/inference/v1/models',
    /**
     * On hosted Sim the platform key is the sim-auto pool's inference key, not a workspace
     * credential: enumerating the whole Fireworks catalog from it would offer every serverless
     * model as selectable when no key can actually run it (`getApiKeyWithBYOK` serves the platform
     * key to catalog models only).
     */
    platformKey: () => (isHosted ? undefined : env.FIREWORKS_API_KEY),
    parse: (body) =>
      fireworksUpstreamResponseSchema.parse(body).data.map((model) => `fireworks/${model.id}`),
  },
  together: {
    url: 'https://api.together.ai/v1/models',
    platformKey: () => env.TOGETHER_API_KEY,
    parse: (body) =>
      togetherUpstreamResponseSchema
        .parse(body)
        .filter((model) => !model.type || !TOGETHER_NON_CHAT_MODEL_TYPES.has(model.type))
        .map((model) => `together/${model.id}`),
  },
  /** BYOK-only: Sim never supplies a hosted key and never bills usage. */
  'ollama-cloud': {
    url: 'https://ollama.com/api/tags',
    platformKey: () => undefined,
    parse: (body) =>
      ollamaUpstreamResponseSchema.parse(body).models.map((model) => `ollama-cloud/${model.name}`),
  },
} as const satisfies Record<string, ModelCatalogSource>

export type ModelCatalogProvider = keyof typeof MODEL_CATALOGS

/**
 * Reads a provider's model catalog with `apiKey`. Every failure is logged and answers an empty
 * list, so the model picker degrades instead of erroring.
 */
async function fetchModelCatalog(
  provider: ModelCatalogProvider,
  apiKey: string | undefined,
  fetchImpl: typeof fetch
): Promise<string[]> {
  if (!apiKey) {
    logger.info('No provider API key available, returning empty models', { provider })
    return []
  }
  const source = MODEL_CATALOGS[provider]
  try {
    const response = await fetchImpl(source.url, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) {
      logger.warn('Failed to fetch provider models', {
        provider,
        status: response.status,
        statusText: response.statusText,
      })
      return []
    }
    const uniqueModels = Array.from(new Set(source.parse(await response.json())))
    const { models } = providerModelsResponseSchema.parse({
      models: filterBlacklistedModels(uniqueModels),
    })
    logger.info('Successfully fetched provider models', {
      provider,
      count: models.length,
      filtered: uniqueModels.length - models.length,
    })
    return models
  } catch (error) {
    logger.error('Error fetching provider models', {
      provider,
      error: getErrorMessage(error, 'Unknown error'),
    })
    return []
  }
}

/**
 * Lists a provider's models for a workspace member: the workspace's BYOK key when it has one,
 * otherwise Sim's key, sent through the workspace organization's outbound route.
 */
const listWorkspaceProviderModels = defineAuthorizedWorkspaceUseCase({
  operation: providerModelOperations.list,
  resolveContext: ({ input }: { input: { provider: ModelCatalogProvider; workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ input, context }) => {
    const byok = await getBYOKKey(context.workspaceId, input.provider)
    const apiKey = byok?.apiKey ?? MODEL_CATALOGS[input.provider].platformKey()
    return fetchModelCatalog(input.provider, apiKey, scopedOutboundFetch)
  },
})

/** A missing workspace or a caller outside it gets the platform catalog, never an error. */
function isWorkspaceUnavailable(error: unknown): boolean {
  return (
    error instanceof OrchestrationError &&
    (error.code === 'not_found' || error.code === 'forbidden')
  )
}

/**
 * The models a provider offers to the caller. A signed-in workspace member reads them with the
 * workspace's key through its egress route; anyone else gets Sim's own catalog, read directly.
 */
export async function listProviderModels(
  provider: ModelCatalogProvider,
  { principal, workspaceId }: { principal: SessionPrincipal | null; workspaceId?: string }
): Promise<string[]> {
  if (principal && workspaceId) {
    try {
      return await listWorkspaceProviderModels.execute({
        principal,
        input: { provider, workspaceId },
      })
    } catch (error) {
      if (!isWorkspaceUnavailable(error)) throw error
    }
  }
  return fetchModelCatalog(
    provider,
    MODEL_CATALOGS[provider].platformKey(),
    // egress-direct: no authorized workspace, so a platform request made with Sim's own key
    fetch
  )
}
