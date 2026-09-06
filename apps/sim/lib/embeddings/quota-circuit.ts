import { sha256Hex } from '@sim/security/hash'
import {
  isProviderQuotaExhausted,
  PROVIDER_QUOTA_COOLDOWN_MS,
  recordProviderCooldown,
} from '@/lib/core/rate-limiter/provider-admission'
import type { EmbeddingProviderKind } from '@/lib/embeddings/types'

export const EMBEDDING_QUOTA_CIRCUIT_TTL_MS = PROVIDER_QUOTA_COOLDOWN_MS

export interface EmbeddingQuotaCircuitIdentity {
  readonly providerId: EmbeddingProviderKind
  /** The credential itself never reaches durable storage or logs. */
  readonly credentialFingerprint: string
}

export function createEmbeddingQuotaCircuitIdentity(
  providerId: EmbeddingProviderKind,
  apiKey: string
): EmbeddingQuotaCircuitIdentity {
  return { providerId, credentialFingerprint: sha256Hex(apiKey) }
}

export function isEmbeddingQuotaCircuitOpen(
  identity: EmbeddingQuotaCircuitIdentity
): Promise<boolean> {
  return isProviderQuotaExhausted({ ...identity, operation: 'embedding' })
}

export function openEmbeddingQuotaCircuit(identity: EmbeddingQuotaCircuitIdentity): Promise<void> {
  return recordProviderCooldown(
    { ...identity, operation: 'embedding' },
    PROVIDER_QUOTA_COOLDOWN_MS,
    true
  )
}
