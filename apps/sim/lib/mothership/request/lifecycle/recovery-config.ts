import { type AnyColumn, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import { secretMountPolicySchema } from '@/lib/api/contracts/secret-mount-policy'
import { hasCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import { COPILOT_REQUEST_MODES } from '@/lib/mothership/constants'
import { ChatPayloadSchema } from '@/lib/mothership/generated/protocol'
import type { CopilotLifecycleOptions } from '@/lib/mothership/request/lifecycle/run'
import type { TurnSecretAuthority } from '@/lib/mothership/secret-mount-policy'

export const BillingAdmissionSchema = z
  .object({
    billingRequestId: z.uuid(),
    serializedAttribution: z.string().min(1).max(32768),
  })
  .strict()

export type BillingAdmission = z.infer<typeof BillingAdmissionSchema>

/** Start intent excludes transport credentials and receipts; takeover resolves those afresh. */
export const DurableChatRequestSchema = ChatPayloadSchema.safeExtend({
  messageId: z.uuid(),
  chatId: z.uuid(),
}).transform(
  ({ byokApiKey, delegationToken, receivedTextChars, receivedActivity, ...request }) => request
)
/**
 * Marks a durable turn admitted to author resources, so recovery restores the admission. Every
 * writer and the recovery reader share this one value.
 */
export const RESOURCE_AUTHORING_VERSION = 1

/**
 * The marker an admitted turn stores for recovery, so a recovered turn keeps its admission. It is
 * written whether or not Projects are on, since copies between workspaces need the admission
 * without them; every release since the marker shipped parses it.
 */
export function durableResourceAuthoringVersion(
  admitted: boolean
): typeof RESOURCE_AUTHORING_VERSION | undefined {
  return admitted ? RESOURCE_AUTHORING_VERSION : undefined
}

/**
 * What a durable turn's recovery restores about its audience. An interactive stream answers a
 * person in the chat; an unattended stream (a scheduled job's occurrence) has nobody to answer a
 * prompt, so a recovered leg runs it non-interactively too, exactly as it was admitted.
 */
const DURABLE_STREAM_KINDS = ['interactive_stream', 'unattended_stream'] as const
export type DurableStreamKind = (typeof DURABLE_STREAM_KINDS)[number]

/** A run's saved request context names a durable turn that recovery can take over. */
export function isDurableStreamRun(requestContext: AnyColumn): SQL {
  return sql`${requestContext}->'recovery'->>'kind' IN (${sql.join(
    DURABLE_STREAM_KINDS.map((kind) => sql`${kind}`),
    sql`, `
  )})`
}

export const StreamRecoveryConfigSchema = z
  .object({
    kind: z.enum(DURABLE_STREAM_KINDS),
    resourceAuthoringVersion: z.literal(RESOURCE_AUTHORING_VERSION).optional(),
    billingAdmission: BillingAdmissionSchema.optional(),
    request: DurableChatRequestSchema,
    goRoute: z.enum(['/api/mothership', '/api/copilot']),
    clientToolPickupExpected: z.boolean(),
    userTimezone: z.string().optional(),
    requestMode: z.enum(COPILOT_REQUEST_MODES).optional(),
  })
  .strict()
  .refine(
    (config) =>
      !config.requestMode ||
      (!config.request.mode && config.requestMode !== 'assistant') ||
      (config.requestMode === 'build' ? 'agent' : config.requestMode) ===
        (config.request.mode ?? 'agent'),
    {
      message: 'Recovery mode must match the admitted request',
    }
  )

export async function streamRecoveryConfig(
  options: CopilotLifecycleOptions,
  request: Record<string, unknown>
) {
  /**
   * A recovered leg keeps the kind its turn was admitted with. A fresh leg is durable only for a
   * person in the chat; an unattended turn is admitted with its recovery intent already written.
   */
  const kind =
    options.recovery?.kind ?? (options.interactive === true ? 'interactive_stream' : undefined)
  if (!kind) return undefined
  const resourceAuthoringVersion = durableResourceAuthoringVersion(
    hasCopilotResourceAdmission({
      ...options,
      ...options.executionContext,
      copilotToolExecution: true,
      copilotResourceAdmission:
        options.executionContext?.copilotResourceAdmission ?? options.copilotResourceAdmission,
    })
  )
  return StreamRecoveryConfigSchema.parse({
    kind,
    request,
    goRoute: options.goRoute ?? '/api/copilot',
    clientToolPickupExpected: options.clientToolPickupExpected ?? true,
    userTimezone: options.executionContext?.userTimezone,
    requestMode: options.executionContext?.requestMode,
    ...(resourceAuthoringVersion ? { resourceAuthoringVersion } : {}),
  })
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
