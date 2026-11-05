import { describe, expect, it } from 'vitest'
import { judgeAnswer } from '@/evals/agent-tool-use/judge'
import { createDeepSeekLiveCompletion } from '@/evals/agent-tool-use/live'

/**
 * Validate the judge prompt against a real model. Opt-in:
 *
 *   EVAL_LIVE=1 DEEPSEEK_API_KEY=... \
 *     bun run --cwd apps/sim test --mode live evals/agent-tool-use/judge.live.test.ts
 *
 * The grounded answer must outscore the invented one, which proves the rubric
 * distinguishes claims the evidence supports from claims it does not.
 */
const LIVE = process.env.EVAL_LIVE === '1' && Boolean(process.env.DEEPSEEK_API_KEY)
const MODEL = process.env.EVAL_MODEL ?? 'deepseek-chat'
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS ?? '120000')

const rubric = {
  criteria: [
    { id: 'grounding', description: 'every factual claim is supported by the evidence' },
    { id: 'completeness', description: 'answers the user request' },
  ],
  minScore: 0.5,
}

describe.skipIf(!LIVE)('llm judge (live)', () => {
  it(
    'scores a grounded answer above an invented one',
    async () => {
      const completion = createDeepSeekLiveCompletion(MODEL)
      const evidence = 'The API rate limit is 100 requests per minute.'

      const grounded = await judgeAnswer({
        completion,
        model: MODEL,
        userMessage: 'What is the API rate limit?',
        answer: 'The API rate limit is 100 requests per minute.',
        evidence,
        rubric,
      })
      const invented = await judgeAnswer({
        completion,
        model: MODEL,
        userMessage: 'What is the API rate limit?',
        answer: 'The API rate limit is 10,000 requests per second on every plan.',
        evidence,
        rubric,
      })

      expect(grounded.weightedScore).toBeGreaterThan(invented.weightedScore)
      expect(grounded.passed).toBe(true)
      expect(invented.passed).toBe(false)
    },
    TIMEOUT_MS
  )
})
