import { db } from '@sim/db'
import { workspaceBYOKKeys } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq } from 'drizzle-orm'
import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { env } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/env-flags'
import { decryptSecret } from '@/lib/core/security/encryption'
import { getHostedModels } from '@/providers/models'
import { PROVIDER_PLACEHOLDER_KEY } from '@/providers/utils'
import { useProvidersStore } from '@/stores/providers/store'
import type { BYOKProviderId } from '@/tools/types'

const logger = createLogger('BYOKKeys')

export interface BYOKKeyResult {
  apiKey: string
  isBYOK: true
}

const rotationCounters = new Map<string, number>()

/**
 * Advances the per-process round-robin cursor for a rotation pool and returns
 * the next index. Counters are per server instance, which keeps rotation free
 * of database writes; aggregate load still spreads evenly across keys.
 */
function nextRotationIndex(poolKey: string, poolSize: number): number {
  const cursor = (rotationCounters.get(poolKey) ?? -1) + 1
  rotationCounters.set(poolKey, cursor)
  return cursor % poolSize
}

/**
 * Resolves a workspace BYOK key for a provider. When the workspace has
 * multiple keys stored for the provider, requests round-robin across them in
 * creation order. A key that fails to decrypt is skipped in favor of the next
 * one in the pool.
 *
 * The key list is read fresh every call (not cached): BYOK is not a hot query,
 * and reading fresh keeps revocation immediate across ECS tasks.
 */
export async function getBYOKKey(
  workspaceId: string | undefined | null,
  providerId: BYOKProviderId
): Promise<BYOKKeyResult | null> {
  if (!workspaceId) {
    return null
  }

  try {
    const keys = await db
      .select({ id: workspaceBYOKKeys.id, encryptedApiKey: workspaceBYOKKeys.encryptedApiKey })
      .from(workspaceBYOKKeys)
      .where(
        and(
          eq(workspaceBYOKKeys.workspaceId, workspaceId),
          eq(workspaceBYOKKeys.providerId, providerId)
        )
      )
      .orderBy(asc(workspaceBYOKKeys.createdAt), asc(workspaceBYOKKeys.id))

    if (!keys.length) {
      return null
    }

    const startIndex = nextRotationIndex(`${workspaceId}:${providerId}`, keys.length)
    for (let offset = 0; offset < keys.length; offset++) {
      const key = keys[(startIndex + offset) % keys.length]
      try {
        const { decrypted } = await decryptSecret(key.encryptedApiKey)
        return { apiKey: decrypted, isBYOK: true }
      } catch (error) {
        logger.error('Failed to decrypt BYOK key, skipping', {
          workspaceId,
          providerId,
          keyId: key.id,
          error,
        })
      }
    }

    return null
  } catch (error) {
    logger.error('Failed to get BYOK key', { workspaceId, providerId, error })
    return null
  }
}

export async function getApiKeyWithBYOK(
  provider: string,
  model: string,
  workspaceId: string | undefined | null,
  userProvidedKey?: string
): Promise<{ apiKey: string; isBYOK: boolean }> {
  const isOllamaModel =
    provider === 'ollama' || useProvidersStore.getState().providers.ollama.models.includes(model)
  if (isOllamaModel) {
    return { apiKey: 'empty', isBYOK: false }
  }

  const isVllmModel =
    provider === 'vllm' || useProvidersStore.getState().providers.vllm.models.includes(model)
  if (isVllmModel) {
    return { apiKey: userProvidedKey || env.VLLM_API_KEY || 'empty', isBYOK: false }
  }

  const isLitellmModel =
    provider === 'litellm' || useProvidersStore.getState().providers.litellm.models.includes(model)
  if (isLitellmModel) {
    return { apiKey: userProvidedKey || env.LITELLM_API_KEY || 'empty', isBYOK: false }
  }

  const isFireworksModel =
    provider === 'fireworks' ||
    useProvidersStore.getState().providers.fireworks.models.includes(model)
  if (isFireworksModel) {
    if (workspaceId) {
      const byokResult = await getBYOKKey(workspaceId, 'fireworks')
      if (byokResult) {
        logger.info('Using BYOK key for Fireworks', { model, workspaceId })
        return byokResult
      }
    }
    if (userProvidedKey) {
      return { apiKey: userProvidedKey, isBYOK: false }
    }
    if (env.FIREWORKS_API_KEY) {
      return { apiKey: env.FIREWORKS_API_KEY, isBYOK: false }
    }
    throw new Error(`API key is required for Fireworks ${model}`)
  }

  const isTogetherModel =
    provider === 'together' ||
    useProvidersStore.getState().providers.together.models.includes(model)
  if (isTogetherModel) {
    if (workspaceId) {
      const byokResult = await getBYOKKey(workspaceId, 'together')
      if (byokResult) {
        logger.info('Using BYOK key for Together AI', { model, workspaceId })
        return byokResult
      }
    }
    if (userProvidedKey) {
      return { apiKey: userProvidedKey, isBYOK: false }
    }
    if (env.TOGETHER_API_KEY) {
      return { apiKey: env.TOGETHER_API_KEY, isBYOK: false }
    }
    throw new Error(`API key is required for Together AI ${model}`)
  }

  const isBasetenModel =
    provider === 'baseten' || useProvidersStore.getState().providers.baseten.models.includes(model)
  if (isBasetenModel) {
    if (workspaceId) {
      const byokResult = await getBYOKKey(workspaceId, 'baseten')
      if (byokResult) {
        logger.info('Using BYOK key for Baseten', { model, workspaceId })
        return byokResult
      }
    }
    if (userProvidedKey) {
      return { apiKey: userProvidedKey, isBYOK: false }
    }
    if (env.BASETEN_API_KEY) {
      return { apiKey: env.BASETEN_API_KEY, isBYOK: false }
    }
    throw new Error(`API key is required for Baseten ${model}`)
  }

  const isOllamaCloudModel =
    provider === 'ollama-cloud' ||
    useProvidersStore.getState().providers['ollama-cloud'].models.includes(model)
  if (isOllamaCloudModel) {
    if (workspaceId) {
      const byokResult = await getBYOKKey(workspaceId, 'ollama-cloud')
      if (byokResult) {
        logger.info('Using BYOK key for Ollama Cloud', { model, workspaceId })
        return byokResult
      }
    }
    if (userProvidedKey) {
      return { apiKey: userProvidedKey, isBYOK: false }
    }
    throw new Error(`API key is required for Ollama Cloud ${model}`)
  }

  const isBedrockModel = provider === 'bedrock' || model.startsWith('bedrock/')
  if (isBedrockModel) {
    return { apiKey: PROVIDER_PLACEHOLDER_KEY, isBYOK: false }
  }

  if (provider === 'azure-openai') {
    return { apiKey: userProvidedKey || env.AZURE_OPENAI_API_KEY || '', isBYOK: false }
  }

  if (provider === 'azure-anthropic') {
    return { apiKey: userProvidedKey || env.AZURE_ANTHROPIC_API_KEY || '', isBYOK: false }
  }

  const isOpenAIModel = provider === 'openai'
  const isClaudeModel = provider === 'anthropic'
  const isGeminiModel = provider === 'google'
  const isMistralModel = provider === 'mistral'
  const isZaiModel = provider === 'zai'
  const isXaiModel = provider === 'xai'
  const isKimiModel = provider === 'kimi'

  const byokProviderId = isGeminiModel ? 'google' : (provider as BYOKProviderId)

  if (
    isHosted &&
    workspaceId &&
    (isOpenAIModel ||
      isClaudeModel ||
      isGeminiModel ||
      isMistralModel ||
      isZaiModel ||
      isXaiModel ||
      isKimiModel)
  ) {
    const hostedModels = getHostedModels()
    const isModelHosted = hostedModels.some((m) => m.toLowerCase() === model.toLowerCase())

    logger.debug('BYOK check', { provider, model, workspaceId, isHosted, isModelHosted })

    if (isModelHosted || isMistralModel) {
      const byokResult = await getBYOKKey(workspaceId, byokProviderId)
      if (byokResult) {
        logger.info('Using BYOK key', { provider, model, workspaceId })
        return byokResult
      }
      logger.debug('No BYOK key found, falling back', { provider, model, workspaceId })

      if (isModelHosted) {
        try {
          const serverKey = getRotatingApiKey(isGeminiModel ? 'gemini' : provider)
          return { apiKey: serverKey, isBYOK: false }
        } catch (_error) {
          if (userProvidedKey) {
            return { apiKey: userProvidedKey, isBYOK: false }
          }
          throw new Error(`No API key available for ${provider} ${model}`)
        }
      }
    }
  }

  if (!userProvidedKey) {
    logger.debug('BYOK not applicable, no user key provided', {
      provider,
      model,
      workspaceId,
      isHosted,
    })
    throw new Error(`API key is required for ${provider} ${model}`)
  }

  return { apiKey: userProvidedKey, isBYOK: false }
}
