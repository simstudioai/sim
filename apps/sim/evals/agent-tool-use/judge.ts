import { createHash } from 'node:crypto'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type {
  JudgeCriterion,
  JudgeIdentity,
  JudgeRubric,
  JudgeScore,
  JudgeVerdict,
} from '@/evals/agent-tool-use/types'
import type { OpenAICompatCreateCompletion } from '@/providers/openai-compat/streaming-tool-loop'

export type { JudgeCriterion, JudgeIdentity, JudgeRubric, JudgeScore, JudgeVerdict }

/**
 * LLM-as-judge scoring for open-ended answers.
 *
 * Substring and regex checks measure phrasing, not correctness — they kept
 * failing on valid paraphrases. A judge model scores an answer against a rubric
 * (grounding, completeness, …) and returns structured numbers, so the eval can
 * assert behavior instead of wording. The judge transport is injectable, so a
 * recorded transcript can replay it deterministically in CI.
 */

export interface JudgeInput {
  completion: OpenAICompatCreateCompletion
  model: string
  userMessage: string
  answer: string
  rubric: JudgeRubric
  /** Tool results or other material the answer should be grounded in. */
  evidence?: string
}

/** Parser/schema revision, bumped when the response contract changes. */
export const JUDGE_PARSER_VERSION = '1'

/**
 * Stable digest of the rubric's grading contract, independent of key order. The
 * passing threshold is part of the contract: changing only `minScore` changes
 * which scores pass, so it must change the digest too.
 */
export function rubricDigest(rubric: JudgeRubric): string {
  const canonical = JSON.stringify({
    minScore: rubric.minScore ?? 0.5,
    criteria: rubric.criteria.map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
      weight: criterion.weight ?? 1,
    })),
  })
  return `sha256:${createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`
}

/** Whether two verdicts may be compared, and which identity fields differ. */
export function compareJudgeIdentities(
  baseline: JudgeIdentity,
  candidate: JudgeIdentity
): { comparable: boolean; differingFields: string[] } {
  const fields: Array<keyof JudgeIdentity> = [
    'model',
    'rubricDigest',
    'parserVersion',
    'temperature',
  ]
  const differingFields = fields.filter((field) => baseline[field] !== candidate[field])
  return { comparable: differingFields.length === 0, differingFields }
}

const JUDGE_SYSTEM_PROMPT =
  'You are a strict, literal evaluator of assistant answers. Score each criterion independently. ' +
  'Do not reward fluency or confidence; reward only what the answer actually establishes. ' +
  'Return ONLY a JSON object of the form {"scores":{"<criterion>":<number 0..1>},"rationale":"<one sentence>"} ' +
  'with no markdown fences and no extra text.'

function buildJudgePrompt(input: JudgeInput): string {
  const criteria = input.rubric.criteria
    .map((criterion) => `- ${criterion.id}: ${criterion.description}`)
    .join('\n')
  return [
    'User request:',
    input.userMessage,
    '',
    'Assistant answer:',
    input.answer || '(empty)',
    '',
    'Evidence available to the assistant (tool results):',
    input.evidence?.trim() || '(none)',
    '',
    'Criteria (score each from 0 to 1):',
    criteria,
  ].join('\n')
}

async function collectContent(iterable: AsyncIterable<ChatCompletionChunk>): Promise<string> {
  let content = ''
  for await (const chunk of iterable) {
    const delta = chunk.choices?.[0]?.delta?.content
    if (typeof delta === 'string') content += delta
  }
  return content
}

/** Strips markdown fences and returns the outermost JSON object as a string. */
function extractJsonObject(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Judge did not return a JSON object')
  }
  return trimmed.slice(start, end + 1)
}

function clampScore(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(1, Math.max(0, value))
}

/** Parses and validates a judge response against the rubric. */
export function parseJudgeVerdict(raw: string, rubric: JudgeRubric): JudgeScore {
  const parsed = JSON.parse(extractJsonObject(raw)) as {
    scores?: Record<string, unknown>
    rationale?: unknown
  }
  const rawScores = parsed.scores
  if (!rawScores || typeof rawScores !== 'object') {
    throw new Error('Judge response is missing "scores"')
  }

  const scores: Record<string, number> = {}
  let weighted = 0
  let totalWeight = 0
  for (const criterion of rubric.criteria) {
    const score = clampScore(rawScores[criterion.id])
    if (score === undefined) {
      throw new Error(`Judge response is missing a score for "${criterion.id}"`)
    }
    const weight = criterion.weight ?? 1
    scores[criterion.id] = score
    weighted += score * weight
    totalWeight += weight
  }

  const weightedScore = totalWeight === 0 ? 0 : weighted / totalWeight
  return {
    scores,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
    weightedScore,
    passed: weightedScore >= (rubric.minScore ?? 0.5),
  }
}

/** Runs the judge model and returns a validated verdict. */
export async function judgeAnswer(input: JudgeInput): Promise<JudgeVerdict> {
  const iterable = await input.completion({
    model: input.model,
    stream: true,
    messages: [
      { role: 'system', content: JUDGE_SYSTEM_PROMPT },
      { role: 'user', content: buildJudgePrompt(input) },
    ],
  })
  const score = parseJudgeVerdict(await collectContent(iterable), input.rubric)
  return {
    ...score,
    identity: {
      model: input.model,
      rubricDigest: rubricDigest(input.rubric),
      parserVersion: JUDGE_PARSER_VERSION,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    },
  }
}
