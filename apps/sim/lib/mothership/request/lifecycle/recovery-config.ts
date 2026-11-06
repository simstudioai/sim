import { z } from 'zod'
import { hasCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import { COPILOT_REQUEST_MODES } from '@/lib/mothership/constants'
import { ChatPayloadSchema } from '@/lib/mothership/generated/protocol'
import { DURABLE_STREAM_KINDS } from '@/lib/mothership/request/lifecycle/durable-run'
import type { CopilotLifecycleOptions } from '@/lib/mothership/request/lifecycle/run'

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
