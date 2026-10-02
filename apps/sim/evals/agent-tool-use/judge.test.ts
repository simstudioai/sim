import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import { describe, expect, it } from 'vitest'
import {
  compareJudgeIdentities,
  judgeAnswer,
  parseJudgeVerdict,
  rubricDigest,
} from '@/evals/agent-tool-use/judge'
import type { OpenAICompatCreateCompletion } from '@/providers/openai-compat/streaming-tool-loop'

function completionReturning(text: string): OpenAICompatCreateCompletion {
  return async () =>
    (async function* () {
      yield {
        id: 'chunk',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'judge',
        choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop', logprobs: null }],
      } satisfies ChatCompletionChunk
    })()
}

const rubric = {
  criteria: [
    { id: 'grounding', description: 'every claim is supported by the evidence' },
    { id: 'completeness', description: 'answers the user request' },
  ],
  minScore: 0.7,
}

describe('judgeAnswer', () => {
  it('parses scores and passes above the threshold', async () => {
    const verdict = await judgeAnswer({
      completion: completionReturning(
        '{"scores":{"grounding":1,"completeness":0.8},"rationale":"grounded"}'
      ),
      model: 'judge',
      userMessage: 'q',
      answer: 'a',
      rubric,
    })
    expect(verdict.scores).toEqual({ grounding: 1, completeness: 0.8 })
    expect(verdict.weightedScore).toBeCloseTo(0.9)
    expect(verdict.passed).toBe(true)
  })

  it('fails below the threshold', async () => {
    const verdict = await judgeAnswer({
      completion: completionReturning(
        '{"scores":{"grounding":0.2,"completeness":0.4},"rationale":"weak"}'
      ),
      model: 'judge',
      userMessage: 'q',
      answer: 'a',
      rubric,
    })
    expect(verdict.passed).toBe(false)
  })
})

describe('parseJudgeVerdict', () => {
  it('unwraps fenced JSON', () => {
    const verdict = parseJudgeVerdict(
      '```json\n{"scores":{"grounding":0.5,"completeness":0.5},"rationale":"ok"}\n```',
      rubric
    )
    expect(verdict.weightedScore).toBe(0.5)
    expect(verdict.rationale).toBe('ok')
  })

  it('clamps out-of-range scores', () => {
    const verdict = parseJudgeVerdict(
      '{"scores":{"grounding":2,"completeness":-1},"rationale":"x"}',
      rubric
    )
    expect(verdict.scores).toEqual({ grounding: 1, completeness: 0 })
  })

  it('applies criterion weights', () => {
    const verdict = parseJudgeVerdict(
      '{"scores":{"grounding":1,"completeness":0},"rationale":"x"}',
      {
        criteria: [
          { id: 'grounding', description: 'g', weight: 3 },
          { id: 'completeness', description: 'c', weight: 1 },
        ],
        minScore: 0.5,
      }
    )
    expect(verdict.weightedScore).toBeCloseTo(0.75)
  })

  it('rejects a response missing a criterion', () => {
    expect(() => parseJudgeVerdict('{"scores":{"grounding":1},"rationale":"x"}', rubric)).toThrow(
      'completeness'
    )
  })

  it('rejects a response that is not a JSON object', () => {
    expect(() => parseJudgeVerdict('I think it is fine.', rubric)).toThrow('JSON object')
  })
})

describe('judge identity', () => {
  it('records the model, parser version, and a digest of the rubric', async () => {
    const verdict = await judgeAnswer({
      completion: completionReturning(
        '{"scores":{"grounding":1,"completeness":1},"rationale":"good"}'
      ),
      model: 'deepseek-chat',
      userMessage: 'q',
      answer: 'a',
      rubric,
    })
    expect(verdict.identity).toMatchObject({ model: 'deepseek-chat', parserVersion: '1' })
    expect(verdict.identity.rubricDigest).toBe(rubricDigest(rubric))
  })

  it('digests the rubric independently of key order', () => {
    const reordered = {
      minScore: 0.7,
      criteria: [
        { description: 'every claim is supported by the evidence', id: 'grounding' },
        { description: 'answers the user request', id: 'completeness' },
      ],
    }
    expect(rubricDigest(reordered)).toBe(rubricDigest(rubric))
  })

  it('changes the digest when a criterion changes', () => {
    const changed = {
      criteria: [
        { id: 'grounding', description: 'changed' },
        { id: 'completeness', description: 'answers the user request' },
      ],
    }
    expect(rubricDigest(changed)).not.toBe(rubricDigest(rubric))
  })

  it('refuses comparison when a material identity field differs', () => {
    const base = { model: 'deepseek-chat', rubricDigest: 'sha256:abc', parserVersion: '1' }
    expect(compareJudgeIdentities(base, { ...base })).toEqual({
      comparable: true,
      differingFields: [],
    })
    expect(compareJudgeIdentities(base, { ...base, model: 'deepseek-reasoner' })).toEqual({
      comparable: false,
      differingFields: ['model'],
    })
    expect(compareJudgeIdentities(base, { ...base, parserVersion: '2' })).toEqual({
      comparable: false,
      differingFields: ['parserVersion'],
    })
  })
})
