import { type Static, type TSchema, Type } from 'typebox'
import { Check, Errors } from 'typebox/schema'
import { scrubPiSecrets } from '@/executor/handlers/pi/redaction'

/** Sandbox path used for the single-use, agent-authored round decision file. */
export const BABYSIT_ROUND_PATH = '/workspace/sim-babysit-round.json'
export const MAX_ROUND_FILE_BYTES = 64_000
export const MAX_THREADS_PER_ROUND = 30
export const MAX_ROUND_REPLY_LENGTH = 10_000
const MAX_ROUND_SUMMARY_LENGTH = 10_000

export const babysitThreadClassificationSchema = Type.Union([
  Type.Literal('fixed'),
  Type.Literal('false_positive'),
  Type.Literal('already_addressed'),
])

const babysitThreadDecisionSchema = Type.Object(
  {
    threadId: Type.String({ minLength: 1, maxLength: 512 }),
    classification: babysitThreadClassificationSchema,
    reply: Type.String({ minLength: 1, maxLength: MAX_ROUND_REPLY_LENGTH }),
  },
  { additionalProperties: false }
)

/** Strict file contract written by Pi at the end of each fixing round. */
export const babysitRoundSchema = Type.Object(
  {
    threads: Type.Array(babysitThreadDecisionSchema, { maxItems: MAX_THREADS_PER_ROUND }),
    summary: Type.Optional(Type.String({ maxLength: MAX_ROUND_SUMMARY_LENGTH })),
  },
  { additionalProperties: false }
)

type BabysitRoundFile = Static<typeof babysitRoundSchema>
export type BabysitThreadClassification = Static<typeof babysitThreadClassificationSchema>

export interface BabysitRoundDecision {
  threadId: string
  classification: BabysitThreadClassification
  reply: string
  /** False only when the agent claimed `fixed` but pushed no corresponding commit. */
  resolvable: boolean
}

export interface ParsedBabysitRound {
  threads: BabysitRoundDecision[]
  summary?: string
  omittedThreadIds: string[]
  contractViolations: string[]
}

function validationDetails(schema: TSchema, value: unknown): string {
  const [, errors] = Errors(schema, value)
  return errors
    .slice(0, 3)
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ')
}

/**
 * Parses and validates a fresh Babysit round file.
 *
 * IDs are confined to the current trusted fetch. Omitted threads remain unresolved, and a
 * `fixed` classification is deliberately not resolvable unless the round actually pushed code.
 */
export function parseBabysitRound(
  raw: string,
  options: {
    allowedThreadIds: ReadonlySet<string>
    secrets: readonly string[]
    commitPushed: boolean
  }
): ParsedBabysitRound {
  if (new TextEncoder().encode(raw).byteLength > MAX_ROUND_FILE_BYTES) {
    throw new Error(`Babysit round file exceeds ${MAX_ROUND_FILE_BYTES} bytes`)
  }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('Babysit round file is not valid JSON')
  }
  if (!Check(babysitRoundSchema, value)) {
    const details = validationDetails(babysitRoundSchema, value)
    throw new Error(`Babysit round file is invalid${details ? `: ${details}` : ''}`)
  }

  const parsed = value as BabysitRoundFile
  const seen = new Set<string>()
  const contractViolations: string[] = []
  const threads = parsed.threads.map((decision, index): BabysitRoundDecision => {
    const threadId = decision.threadId.trim()
    if (!threadId) throw new Error(`threads[${index}].threadId must not be blank`)
    if (!options.allowedThreadIds.has(threadId)) {
      throw new Error(`threads[${index}].threadId was not fetched in this round`)
    }
    if (seen.has(threadId)) {
      throw new Error(`threads[${index}].threadId is duplicated`)
    }
    seen.add(threadId)

    const reply = scrubPiSecrets(decision.reply.trim(), options.secrets)
    if (!reply) throw new Error(`threads[${index}].reply must not be blank`)
    const resolvable = decision.classification !== 'fixed' || options.commitPushed
    if (!resolvable) {
      contractViolations.push(
        `Thread ${threadId} was classified as fixed without a pushed commit and was left unresolved.`
      )
    }
    return {
      threadId,
      classification: decision.classification,
      reply,
      resolvable,
    }
  })

  const omittedThreadIds = [...options.allowedThreadIds].filter((threadId) => !seen.has(threadId))
  const summary = parsed.summary?.trim()
  return {
    threads,
    ...(summary ? { summary: scrubPiSecrets(summary, options.secrets) } : {}),
    omittedThreadIds,
    contractViolations,
  }
}
