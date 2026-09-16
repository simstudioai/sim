import { db } from '@sim/db'
import { rateLimitBucket } from '@sim/db/schema'
import { inArray } from 'drizzle-orm'

/** Matches OpenAI's requested Float32 base64 transport with a deterministic unit vector. */
export function createFixtureOpenAIEmbedding(dimensions = 1536): string {
  const bytes = Buffer.alloc(dimensions * Float32Array.BYTES_PER_ELEMENT)
  bytes.writeFloatLE(1, 0)
  return bytes.toString('base64')
}

/** Prevents simulated processing clocks from leaking future shared balances into later fixtures. */
export async function resetHostedEmbeddingFixtureAdmission(): Promise<void> {
  const prefix = 'provider:embedding:openai:hosted:openai'
  await db.delete(rateLimitBucket).where(
    inArray(
      rateLimitBucket.key,
      ['requests', 'tokens', 'cooldown', 'quota'].map((dimension) => `${prefix}:${dimension}`)
    )
  )
}
