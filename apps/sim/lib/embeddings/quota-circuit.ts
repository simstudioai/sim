import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getRedisClient } from '@/lib/core/config/redis'
import type { EmbeddingProviderKind } from '@/lib/embeddings/types'

const logger = createLogger('EmbeddingQuotaCircuit')

/**
 * A billing change can take a couple of minutes to reach a provider. Keeping the
 * circuit open for five minutes absorbs the document queue that observed the
 * same exhausted credential while still probing again without operator action.
 */
export const EMBEDDING_QUOTA_CIRCUIT_TTL_MS = 5 * 60 * 1000

const REDIS_KEY_PREFIX = 'embedding-quota-circuit:'
const MAX_LOCAL_CIRCUITS = 1024
const OPEN_QUOTA_CIRCUIT_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]))
local proposed = tonumber(ARGV[1])
local expiry = proposed
if current and current > proposed then
  expiry = current
end
redis.call('SET', KEYS[1], tostring(expiry), 'PXAT', expiry)
return expiry
`

export interface EmbeddingQuotaCircuitIdentity {
  readonly providerId: EmbeddingProviderKind
  /** SHA-256 fingerprint; the provider credential itself never reaches cache or logs. */
  readonly credentialFingerprint: string
}

const localCircuits = new Map<string, number>()

function writeLocalCircuit(key: string, expiresAt: number, now: number): void {
  for (const [candidateKey, candidateExpiry] of localCircuits) {
    if (candidateExpiry <= now) localCircuits.delete(candidateKey)
  }
  const currentExpiry = localCircuits.get(key)
  if (currentExpiry !== undefined) {
    localCircuits.set(key, Math.max(currentExpiry, expiresAt))
    return
  }
  while (localCircuits.size >= MAX_LOCAL_CIRCUITS) {
    const oldestKey = localCircuits.keys().next().value
    if (oldestKey === undefined) break
    localCircuits.delete(oldestKey)
  }
  localCircuits.set(key, expiresAt)
}

function circuitKey(identity: EmbeddingQuotaCircuitIdentity): string {
  return `${identity.providerId}:${identity.credentialFingerprint}`
}

function redisKey(identity: EmbeddingQuotaCircuitIdentity): string {
  return `${REDIS_KEY_PREFIX}${circuitKey(identity)}`
}

/** Isolates quota state to the exact provider credential without retaining the secret. */
export function createEmbeddingQuotaCircuitIdentity(
  providerId: EmbeddingProviderKind,
  apiKey: string
): EmbeddingQuotaCircuitIdentity {
  return {
    providerId,
    credentialFingerprint: sha256Hex(apiKey),
  }
}

function readLocalCircuit(identity: EmbeddingQuotaCircuitIdentity, now: number): boolean {
  const key = circuitKey(identity)
  const expiresAt = localCircuits.get(key)
  if (expiresAt === undefined) return false
  if (expiresAt > now) return true
  localCircuits.delete(key)
  return false
}

/**
 * Returns whether another worker has already observed exhausted credit for this
 * credential. Cache failures deliberately fail open: quota protection must not
 * turn a Redis outage into a knowledge-search outage.
 */
export async function isEmbeddingQuotaCircuitOpen(
  identity: EmbeddingQuotaCircuitIdentity,
  now = Date.now()
): Promise<boolean> {
  if (readLocalCircuit(identity, now)) return true

  try {
    const redis = getRedisClient()
    if (!redis) return false
    const storedExpiry = await redis.get(redisKey(identity))
    if (!storedExpiry) return false
    const expiresAt = Number(storedExpiry)
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return false
    writeLocalCircuit(circuitKey(identity), expiresAt, now)
    return true
  } catch (error) {
    logger.warn('Failed to read embedding quota circuit; continuing with provider request', {
      providerId: identity.providerId,
      error,
    })
    return false
  }
}

/**
 * Shares a provider-declared exhausted-credit result with every worker using
 * the same credential. The absolute expiry keeps a late reader from extending
 * the circuit by another full TTL.
 */
export async function openEmbeddingQuotaCircuit(
  identity: EmbeddingQuotaCircuitIdentity,
  now = Date.now()
): Promise<void> {
  const expiresAt = now + EMBEDDING_QUOTA_CIRCUIT_TTL_MS
  writeLocalCircuit(circuitKey(identity), expiresAt, now)

  try {
    const redis = getRedisClient()
    if (!redis) return
    await redis.eval(OPEN_QUOTA_CIRCUIT_SCRIPT, 1, redisKey(identity), String(expiresAt))
  } catch (error) {
    logger.warn('Failed to share embedding quota circuit; process-local circuit remains active', {
      providerId: identity.providerId,
      error,
    })
  }
}

export function resetEmbeddingQuotaCircuitsForTesting(): void {
  localCircuits.clear()
}
