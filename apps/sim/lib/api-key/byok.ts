import { db } from '@sim/db'
import { organizationBYOKKeys, workspace, workspaceBYOKKeys } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, notExists } from 'drizzle-orm'
import { isOrganizationBYOKEntitledCached } from '@/lib/api-key/byok-entitlement'
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
  /**
   * Which pool the key came from. A workspace key and an inherited organization
   * key are indistinguishable to the caller otherwise, which makes "why did this
   * run use a key I never set on this workspace?" unanswerable from the logs.
   */
  scope: BYOKKeyScopeName
}

export type BYOKKeyScopeName = 'workspace' | 'organization'

const rotationCounters = new Map<string, number>()

interface EncryptedBYOKKey {
  id: string
  encryptedApiKey: string
}

interface BYOKKeyScope {
  workspaceId: string
  organizationId?: string
}

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
 * Rotates through one already-selected key pool, skipping corrupt ciphertext.
 * Callers choose the pool before invoking this helper so a broken workspace
 * pool can never fall through to an organization pool.
 */
async function decryptBYOKPool(
  keys: readonly EncryptedBYOKKey[],
  rotationPoolKey: string,
  providerId: BYOKProviderId,
  scope: BYOKKeyScope,
  scopeName: BYOKKeyScopeName
): Promise<BYOKKeyResult | null> {
  const startIndex = nextRotationIndex(rotationPoolKey, keys.length)
  for (let offset = 0; offset < keys.length; offset++) {
    const key = keys[(startIndex + offset) % keys.length]
    try {
      const { decrypted } = await decryptSecret(key.encryptedApiKey)
      return { apiKey: decrypted, isBYOK: true, scope: scopeName }
    } catch (error) {
      logger.error('Failed to decrypt BYOK key, skipping', {
        ...scope,
        providerId,
        keyId: key.id,
        error,
      })
    }
  }

  return null
}

/**
 * Resolves the effective BYOK key for a workspace and provider. A nonempty
 * workspace pool is always exclusive. Only a successful zero-row workspace
 * lookup may inherit the live organization pool, which is entitlement-gated
 * before any organization key is rotated or decrypted.
 *
 * The key list is read fresh every call (not cached), which keeps revocation
 * immediate across ECS tasks. The organization *entitlement* is the one thing
 * that is cached, because this runs once per agent block and once per tool call
 * — see `isOrganizationBYOKEntitledCached` for why bounded staleness is safe on
 * a billing gate but not on key material.
 */
export async function getBYOKKey(
  workspaceId: string | undefined | null,
  providerId: BYOKProviderId
): Promise<BYOKKeyResult | null> {
  if (!workspaceId) {
    return null
  }

  try {
    const workspaceKeys = await db
      .select({ id: workspaceBYOKKeys.id, encryptedApiKey: workspaceBYOKKeys.encryptedApiKey })
      .from(workspaceBYOKKeys)
      .where(
        and(
          eq(workspaceBYOKKeys.workspaceId, workspaceId),
          eq(workspaceBYOKKeys.providerId, providerId)
        )
      )
      .orderBy(asc(workspaceBYOKKeys.createdAt), asc(workspaceBYOKKeys.id))

    if (workspaceKeys.length) {
      return decryptBYOKPool(
        workspaceKeys,
        `${workspaceId}:${providerId}`,
        providerId,
        { workspaceId },
        'workspace'
      )
    }

    const organizationKeys = await db
      .select({
        organizationId: organizationBYOKKeys.organizationId,
        id: organizationBYOKKeys.id,
        encryptedApiKey: organizationBYOKKeys.encryptedApiKey,
      })
      .from(workspace)
      .innerJoin(
        organizationBYOKKeys,
        eq(organizationBYOKKeys.organizationId, workspace.organizationId)
      )
      .where(
        and(
          eq(workspace.id, workspaceId),
          eq(organizationBYOKKeys.providerId, providerId),
          notExists(
            db
              .select({ id: workspaceBYOKKeys.id })
              .from(workspaceBYOKKeys)
              .where(
                and(
                  eq(workspaceBYOKKeys.workspaceId, workspace.id),
                  eq(workspaceBYOKKeys.providerId, providerId)
                )
              )
          )
        )
      )
      .orderBy(asc(organizationBYOKKeys.createdAt), asc(organizationBYOKKeys.id))

    if (!organizationKeys.length) {
      return null
    }

    const organizationId = organizationKeys[0].organizationId
    if (!(await isOrganizationBYOKEntitledCached(organizationId))) {
      return null
    }

    return decryptBYOKPool(
      organizationKeys,
      `organization:${organizationId}:${providerId}`,
      providerId,
      { workspaceId, organizationId },
      'organization'
    )
  } catch (error) {
    logger.error('Failed to get BYOK key', { workspaceId, providerId, error })
    return null
  }
}

/**
 * `scope` is present only when the key came from a stored BYOK pool; a
 * Sim-hosted, env, or caller-supplied key has no scope. Declared rather than
 * dropped so the returned type matches what a BYOK branch actually hands back.
 */
export async function getApiKeyWithBYOK(
  provider: string,
  model: string,
  workspaceId: string | undefined | null,
  userProvidedKey?: string
): Promise<{ apiKey: string; isBYOK: boolean; scope?: BYOKKeyScopeName }> {
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
        logger.info('Using BYOK key for Fireworks', { model, workspaceId, scope: byokResult.scope })
        return byokResult
      }
    }

    /**
     * On hosted Sim the platform Fireworks key backs the static catalog (the
     * sim-auto pool) and nothing else, exactly as the platform Anthropic and
     * OpenAI keys back only their catalogued models. A dynamic `fireworks/*`
     * id a workspace configured itself carries no catalog pricing, so
     * `shouldBillModelUsage` would return false for it — serving it on Sim's
     * key would be unmetered inference.
     */
    if (isHosted) {
      const isModelHosted = getHostedModels().some((m) => m.toLowerCase() === model.toLowerCase())
      if (isModelHosted) {
        try {
          const serverKey = getRotatingApiKey('fireworks')
          return { apiKey: serverKey, isBYOK: false }
        } catch (_error) {
          if (userProvidedKey) {
            return { apiKey: userProvidedKey, isBYOK: false }
          }
          throw new Error(`No API key available for fireworks ${model}`)
        }
      }

      if (userProvidedKey) {
        return { apiKey: userProvidedKey, isBYOK: false }
      }
      throw new Error(`API key is required for Fireworks ${model}`)
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
        logger.info('Using BYOK key for Together AI', {
          model,
          workspaceId,
          scope: byokResult.scope,
        })
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
        logger.info('Using BYOK key for Baseten', { model, workspaceId, scope: byokResult.scope })
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
        logger.info('Using BYOK key for Ollama Cloud', {
          model,
          workspaceId,
          scope: byokResult.scope,
        })
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
        logger.info('Using BYOK key', { provider, model, workspaceId, scope: byokResult.scope })
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
