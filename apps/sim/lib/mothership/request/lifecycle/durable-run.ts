/**
 * What a run's saved request context says about its durability, kept free of the chat protocol
 * schema so the run repository and the sweeps can read it without loading the lifecycle.
 */
import { type AnyColumn, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import { secretMountPolicySchema } from '@/lib/api/contracts/secret-mount-policy'
import type { TurnSecretAuthority } from '@/lib/mothership/secret-mount-policy'

/**
 * What a durable turn's recovery restores about its audience. An interactive stream answers a
 * person in the chat; an unattended stream (a scheduled job's occurrence) has nobody to answer a
 * prompt, so a recovered leg runs it non-interactively too, exactly as it was admitted.
 */
export const DURABLE_STREAM_KINDS = ['interactive_stream', 'unattended_stream'] as const
export type DurableStreamKind = (typeof DURABLE_STREAM_KINDS)[number]

/** A run's saved request context names a durable turn that recovery can take over. */
export function isDurableStreamRun(requestContext: AnyColumn): SQL {
  return sql`${requestContext}->'recovery'->>'kind' IN (${sql.join(
    DURABLE_STREAM_KINDS.map((kind) => sql`${kind}`),
    sql`, `
  )})`
}

const RecordedSecretAuthoritySchema = z.object({
  secretMountPolicy: secretMountPolicySchema,
  secretActorUserId: z.string().nullable(),
})

/**
 * The secret authority a run recorded at admission (`requestContext.secretAuthority`), or
 * undefined when it recorded none or garbage.
 */
export function parseRecordedSecretAuthority(value: unknown): TurnSecretAuthority | undefined {
  const recorded = RecordedSecretAuthoritySchema.safeParse(value)
  return recorded.success ? recorded.data : undefined
}
