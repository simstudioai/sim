import { db } from '@sim/db'
import { rateLimitBucket } from '@sim/db/schema'
import { inArray } from 'drizzle-orm'

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
