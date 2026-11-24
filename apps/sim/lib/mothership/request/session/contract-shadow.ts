import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { LRUCache } from 'lru-cache'
import {
  MothershipStreamV1EventEnvelopeSchema,
  MothershipStreamV1ResourceOp,
  MothershipStreamV1RunKind,
  MothershipStreamV1SessionKind,
  MothershipStreamV1SpanPayloadKind,
  MothershipStreamV1ToolPhase,
} from '@/lib/mothership/generated/mothership-stream-v1'
import { CopilotStreamContractDirection } from '@/lib/mothership/observability/trace-attribute-values'
import { recordStreamContractDisagreement } from '@/lib/mothership/request/metrics'
import {
  isContractStreamEventEnvelope,
  KNOWN_EVENT_TYPES,
  type ParseStreamEventEnvelopeResult,
  parsePersistedStreamEventEnvelope,
} from '@/lib/mothership/request/session/contract'

/**
 * Server-side ingest of worker stream frames, with a shadow check of the generated
 * contract schema (mothership-stream-v1, its zod schemas the single source).
 *
 * `parsePersistedStreamEventEnvelope` keeps deciding every frame. The schema runs beside it
 * on the frames the worker sends Sim (the live leg and the run replay), never in the browser,
 * and each disagreement is counted and logged, so the frames the schema would newly reject
 * are known before it becomes the validator.
 */

const logger = createLogger('StreamContractShadow')

/** One log line per distinct disagreement per window; the counter still sees every frame. */
const LOG_WINDOW_MS = 10 * 60 * 1000
/** Memory backstop on distinct disagreements tracked within one window. */
const MAX_TRACKED_DISAGREEMENTS = 256
/** Issue paths kept per log line. */
const MAX_LOGGED_ISSUES = 8

const KNOWN_VARIANTS: ReadonlySet<string> = new Set<string>([
  ...Object.values(MothershipStreamV1SessionKind),
  ...Object.values(MothershipStreamV1ToolPhase),
  ...Object.values(MothershipStreamV1SpanPayloadKind),
  ...Object.values(MothershipStreamV1RunKind),
  ...Object.values(MothershipStreamV1ResourceOp),
])

/** Each logged disagreement, live for its window, with the repeats skipped since it logged. */
const recentDisagreements = new LRUCache<string, { suppressed: number }>({
  max: MAX_TRACKED_DISAGREEMENTS,
  ttl: LOG_WINDOW_MS,
  // Wall-clock windows read fresh on every check (no timer-cached `now`): one clock read per
  // disagreement costs nothing, and it is the clock tests move.
  perf: { now: () => Date.now() },
  ttlResolution: 0,
})

/**
 * Parses one stream frame a worker sent this server. The verdict is exactly
 * `parsePersistedStreamEventEnvelope`'s; the shadow check only observes.
 */
export function parseIngestedStreamEventEnvelope(value: unknown): ParseStreamEventEnvelopeResult {
  const result = parsePersistedStreamEventEnvelope(value)
  try {
    shadowCheck(value, result)
  } catch (error) {
    const message = getErrorMessage(error)
    const suppressed = takeLogSlot(`shadow_check_failed|${message}`)
    if (suppressed !== null) {
      logger.warn('Stream contract shadow check failed', {
        error: message,
        ...(suppressed > 0 ? { suppressedSinceLastLog: suppressed } : {}),
      })
    }
  }
  return result
}

function shadowCheck(value: unknown, result: ParseStreamEventEnvelopeResult): void {
  if (result.ok && acceptedAsSyntheticPreview(value)) return
  const schema = MothershipStreamV1EventEnvelopeSchema.safeParse(value)
  if (schema.success === result.ok) return

  const direction = result.ok
    ? CopilotStreamContractDirection.SchemaRejects
    : CopilotStreamContractDirection.SchemaAccepts
  const { eventType, variant } = describeFrame(value)
  recordStreamContractDisagreement(direction, eventType, variant)

  const issues = schema.success
    ? []
    : schema.error.issues
        .slice(0, MAX_LOGGED_ISSUES)
        .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.code}`)
  const validatorErrors = result.ok ? [] : (result.errors ?? [])
  const key = [direction, eventType, variant, ...issues, ...validatorErrors].join('|')
  const suppressed = takeLogSlot(key)
  if (suppressed === null) return

  logger.warn('Stream contract schema disagrees with the stream validator', {
    direction,
    eventType,
    variant,
    ...(issues.length > 0 ? { issues } : {}),
    ...(validatorErrors.length > 0 ? { validatorErrors } : {}),
    ...(suppressed > 0 ? { suppressedSinceLastLog: suppressed } : {}),
  })
}

/**
 * Whether the validator accepted this frame as one of Sim's synthetic file-preview frames,
 * which are outside the contract. It tries the contract first, so that is exactly a frame the
 * contract check rejects; only a payload with `previewPhase` can be one, which keeps the
 * re-check off every other frame. A worker frame with a stray `previewPhase` that passes the
 * contract check is still compared.
 */
function acceptedAsSyntheticPreview(value: unknown): boolean {
  return (
    isRecordLike(value) &&
    toRecord(value.payload).previewPhase !== undefined &&
    !isContractStreamEventEnvelope(value)
  )
}

/** The frame's type and payload discriminant, each capped to the contract's vocabulary. */
function describeFrame(value: unknown): { eventType: string; variant: string } {
  if (!isRecordLike(value)) return { eventType: 'other', variant: 'none' }
  const eventType =
    typeof value.type === 'string' && KNOWN_EVENT_TYPES.has(value.type) ? value.type : 'other'
  const payload = toRecord(value.payload)
  const discriminant = payload.phase ?? payload.kind ?? payload.op
  if (discriminant === undefined) return { eventType, variant: 'none' }
  const variant =
    typeof discriminant === 'string' && KNOWN_VARIANTS.has(discriminant) ? discriminant : 'other'
  return { eventType, variant }
}

/**
 * Whether this disagreement may be logged now: the number of repeats skipped since its last
 * line, or `null` while its window is still open.
 */
function takeLogSlot(key: string): number | null {
  const live = recentDisagreements.peek(key)
  if (live) {
    live.suppressed += 1
    return null
  }
  const expired = recentDisagreements.peek(key, { allowStale: true })
  recentDisagreements.set(key, { suppressed: 0 })
  return expired?.suppressed ?? 0
}
