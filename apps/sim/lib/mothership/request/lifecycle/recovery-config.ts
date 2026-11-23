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

const WORKER_ROUTES = ['/api/mothership', '/api/copilot'] as const

/**
 * The recovery intent as stored on the run. The worker route is persisted as `goRoute`, a name
 * every deployed and self-hosted Sim parses under `.strict()`, so it is never renamed; this module
 * is the only place that names it.
 */
const PersistedStreamRecoveryConfigSchema = z
  .object({
    kind: z.enum(DURABLE_STREAM_KINDS),
    resourceAuthoringVersion: z.literal(RESOURCE_AUTHORING_VERSION).optional(),
    billingAdmission: BillingAdmissionSchema.optional(),
    request: DurableChatRequestSchema,
    goRoute: z.enum(WORKER_ROUTES),
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

type PersistedStreamRecoveryConfig = z.output<typeof PersistedStreamRecoveryConfigSchema>

/** Reads a stored recovery intent, exposing its route as `workerRoute`. */
export const StreamRecoveryConfigSchema = PersistedStreamRecoveryConfigSchema.transform(
  ({ goRoute, ...config }) => ({ ...config, workerRoute: goRoute })
)

/** A recovery intent as code builds it, before it is validated for storage. */
export type StreamRecoveryConfigInput = Omit<
  z.input<typeof PersistedStreamRecoveryConfigSchema>,
  'goRoute'
> & { workerRoute: (typeof WORKER_ROUTES)[number] }

/** Validates a recovery intent and returns the shape stored on the run. */
export function persistedStreamRecoveryConfig({
  workerRoute,
  ...config
}: StreamRecoveryConfigInput): PersistedStreamRecoveryConfig {
  return PersistedStreamRecoveryConfigSchema.parse({ ...config, goRoute: workerRoute })
}

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
  return PersistedStreamRecoveryConfigSchema.parse({
    kind,
    request,
    goRoute: options.workerRoute ?? '/api/copilot',
    clientToolPickupExpected: options.clientToolPickupExpected ?? true,
    userTimezone: options.executionContext?.userTimezone,
    requestMode: options.executionContext?.requestMode,
    ...(resourceAuthoringVersion ? { resourceAuthoringVersion } : {}),
  })
}
