import { db } from '@sim/db'
import { workspaceBYOKKeys } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { isHosted } from '@/lib/core/config/feature-flags'
import { decryptSecret } from '@/lib/core/security/encryption'
import { getHostedModels } from '@/providers/models'
import { useProvidersStore } from '@/stores/providers/store'

const logger = createLogger('BYOKKeys')

export type BYOKProviderId = 'openai' | 'anthropic' | 'google' | 'mistral'

export interface BYOKKeyResult {
  apiKey: string
  isBYOK: true
}

export async function getBYOKKey(
  workspaceId: string | undefined | null,
  providerId: BYOKProviderId
): Promise<BYOKKeyResult | null> {
  if (!workspaceId) {
    return null
  }

  try {
    const result = await db
      .select({ encryptedApiKey: workspaceBYOKKeys.encryptedApiKey })
      .from(workspaceBYOKKeys)
      .where(
        and(
          eq(workspaceBYOKKeys.workspaceId, workspaceId),
          eq(workspaceBYOKKeys.providerId, providerId)
        )
      )
      .limit(1)

    if (!result.length) {
      return null
    }

    const { decrypted } = await decryptSecret(result[0].encryptedApiKey)
    return { apiKey: decrypted, isBYOK: true }
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
    return { apiKey: userProvidedKey || 'empty', isBYOK: false }
  }

  const isBedrockModel = provider === 'bedrock' || model.startsWith('bedrock/')
  if (isBedrockModel) {
    return { apiKey: 'bedrock-uses-own-credentials', isBYOK: false }
  }

  const isOpenAIModel = provider === 'openai'
  const isClaudeModel = provider === 'anthropic'
  const isGeminiModel = provider === 'google'
  const isMistralModel = provider === 'mistral'

  const byokProviderId = isGeminiModel ? 'google' : (provider as BYOKProviderId)

  if (
    isHosted &&
    workspaceId &&
    (isOpenAIModel || isClaudeModel || isGeminiModel || isMistralModel)
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
