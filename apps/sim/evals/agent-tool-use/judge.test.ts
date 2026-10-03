import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import { describe, expect, it } from 'vitest'
import { judgeAnswer, parseJudgeVerdict } from '@/evals/agent-tool-use/judge'
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
