import { sha256Hex } from '@sim/security/hash'
import { z } from 'zod'
import { getRedisClient } from '@/lib/core/config/redis'

interface SearchConnectionCompletionScope {
  organizationId: string
  userId: string
  completionId: string
}
const receiptSchema = z.object({ credentialId: z.string().min(1).max(128) }).strict()

function completionKey(scope: SearchConnectionCompletionScope) {
  return `search:connection-completion:${sha256Hex(JSON.stringify([scope.organizationId, scope.userId, scope.completionId]))}`
}

/** A short-lived receipt proves which OAuth attempt committed, even after a page reload. */
export async function recordSearchConnectionCompletion(
  input: SearchConnectionCompletionScope & { credentialId: string }
) {
  const redis = getRedisClient()
  if (!redis) throw new Error('Search connection completion requires Redis')
  const stored = await redis.set(
    completionKey(input),
    JSON.stringify(receiptSchema.parse({ credentialId: input.credentialId })),
    'EX',
    86_400,
    'NX'
  )
  if (stored !== 'OK') throw new Error('Search connection completion was already recorded')
}

/** Called only inside the authorized personal inventory read; scope never comes from a tag. */
export async function readSearchConnectionCompletion(
  scope: SearchConnectionCompletionScope
): Promise<string | null> {
  const redis = getRedisClient()
  if (!redis) throw new Error('Search connection completion requires Redis')
  const value = await redis.get(completionKey(scope))
  return value ? receiptSchema.parse(JSON.parse(value)).credentialId : null
}
