import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike, toRecord } from '@sim/utils/object'
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
/** Distinct disagreements remembered at once; past it the oldest is forgotten. */
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

const recentDisagreements = new Map<string, { loggedAt: number; suppressed: number }>()

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
  // Sim's own synthetic file-preview frames are outside the contract; only they carry
  // `previewPhase`, so the cheap check stands in for re-running the contract validator.
  if (result.ok && isRecordLike(value) && toRecord(value.payload).previewPhase !== undefined) return
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
  const now = Date.now()
  const seen = recentDisagreements.get(key)
  if (seen && now - seen.loggedAt < LOG_WINDOW_MS) {
    seen.suppressed += 1
    return null
  }
  recentDisagreements.delete(key)
  // Every entry is (re)inserted when it logs, so insertion order is `loggedAt` order: the
  // oldest entry is the most expired one, and evicting it never drops a live window first.
  if (recentDisagreements.size >= MAX_TRACKED_DISAGREEMENTS) {
    const oldest = recentDisagreements.keys().next().value
    if (oldest !== undefined) recentDisagreements.delete(oldest)
  }
  recentDisagreements.set(key, { loggedAt: now, suppressed: 0 })
  return seen?.suppressed ?? 0
}
