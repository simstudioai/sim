import { createLogger } from '@sim/logger'
import { getBYOKKey } from '@/lib/api-key/byok'
import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { env } from '@/lib/core/config/env'
import { BYOK_PROVIDER_IDS } from '@/lib/embeddings/catalog'
import type { KeyedEmbeddingProvider } from '@/lib/embeddings/types'
import type { BYOKProviderId } from '@/tools/types'

const logger = createLogger('EmbeddingKeys')

export interface ResolvedEmbeddingKey {
  apiKey: string
  /** True when a workspace-owned key was used, meaning Sim does not bill for it. */
  isBYOK: boolean
}

interface ProviderKeyConfig {
  /** BYOK provider id used to look up a workspace-owned key. */
  byokProviderId: BYOKProviderId
  /** Singular platform key, checked before the rotating pool. */
  envKey: string | undefined
  /** Provider id for the rotating key pool, when one exists. */
  rotatingProvider?: string
  missingKeyError: string
}

/**
 * Resolution order per provider is BYOK -> singular env key -> rotating pool.
 * `env` is read lazily through a getter so tests that stub `env` still work.
 */
const PROVIDER_KEY_CONFIG: Record<KeyedEmbeddingProvider, () => ProviderKeyConfig> = {
  openai: () => ({
    byokProviderId: BYOK_PROVIDER_IDS.openai,
    envKey: env.OPENAI_API_KEY,
    rotatingProvider: 'openai',
    missingKeyError: 'OPENAI_API_KEY is not configured',
  }),
  gemini: () => ({
    byokProviderId: BYOK_PROVIDER_IDS.gemini,
    envKey: env.GEMINI_API_KEY,
    rotatingProvider: 'gemini',
    missingKeyError:
      'GEMINI_API_KEY (or GEMINI_API_KEY_1/2/3 for rotation) must be configured for Gemini embeddings',
  }),
  cohere: () => ({
    byokProviderId: BYOK_PROVIDER_IDS.cohere,
    envKey: env.COHERE_API_KEY,
    rotatingProvider: 'cohere',
    missingKeyError:
      'COHERE_API_KEY (or COHERE_API_KEY_1/2/3 for rotation) must be configured for Cohere embeddings',
  }),
  mistral: () => ({
    byokProviderId: BYOK_PROVIDER_IDS.mistral,
    envKey: env.MISTRAL_API_KEY,
    missingKeyError: 'MISTRAL_API_KEY must be configured for Mistral embeddings',
  }),
}

export async function resolveProviderKey(
  provider: KeyedEmbeddingProvider,
  workspaceId?: string | null
): Promise<ResolvedEmbeddingKey> {
  const config = PROVIDER_KEY_CONFIG[provider]()

  if (workspaceId) {
    const byokResult = await getBYOKKey(workspaceId, config.byokProviderId)
    if (byokResult) {
      logger.info(`Using ${byokResult.scope} BYOK key for ${provider} embeddings`)
      return { apiKey: byokResult.apiKey, isBYOK: true }
    }
  }

  if (config.envKey) {
    return { apiKey: config.envKey, isBYOK: false }
  }

  if (config.rotatingProvider) {
    try {
      return { apiKey: getRotatingApiKey(config.rotatingProvider), isBYOK: false }
    } catch {
      throw new Error(config.missingKeyError)
    }
  }

  throw new Error(config.missingKeyError)
}
