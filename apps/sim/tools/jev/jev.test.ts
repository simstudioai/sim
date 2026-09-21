import { describe, expect, it } from 'vitest'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { jevChoiceTool, jevEvaluateTool, jevNoulTool, jevScoreTool } from '@/tools/jev'
import type { JevEvaluateParams } from '@/tools/jev/types'
import { prepareToolRequest } from '@/tools/request-transport'

const BASE = { apiKey: 'test-key', state: 'My payouts have been failing for three days.' }
const USAGE = { input_tokens: 318, output_tokens: 34 }
const CHOICE = {
  type: 'choice',
  choice: 'billing',
  probabilities: { billing: 0.88, technical: 0.12 },
  confidence: 0.81,
} as const
const SCORE = {
  type: 'score',
  score: 1.05,
  legend: { '0': 'Calm', '1': 'Frustrated', '2': 'Very angry' },
  probabilities: { '0': 0, '1': 0.95, '2': 0.05 },
  confidence: 0.92,
} as const
const NOUL = { type: 'noul', noul: 0.95 } as const
const BATCH_PARAMS: JevEvaluateParams = {
  ...BASE,
  questions: {
    department: {
      type: 'choice',
      instructions: 'Which team?',
      criteria: { billing: null, technical: null },
    },
    frustration: {
      type: 'score',
      instructions: 'How frustrated?',
      criteria: ['Calm', 'Frustrated', 'Very angry'],
    },
    is_urgent: { type: 'noul', instructions: 'Is this urgent?' },
  },
}

function response(answers: Record<string, unknown>) {
  return Response.json({ model: 'jev-1.13.0', answers, usage: USAGE })
}

describe('Jev tools', () => {
  it('formats Choice as one native System One question', () => {
    const request = prepareToolRequest(jevChoiceTool, {
      ...BASE,
      instructions: 'Which team should handle this?',
      criteria: '{"billing":null,"technical":"Bugs and outages"}',
    })
    expect(request.url).toBe('https://api.typesafe.ai/v1/systemone')
    expect(request.method).toBe('POST')
    expect(request.headers.get('Authorization')).toBe('Bearer test-key')
    expect(JSON.parse(request.body!)).toEqual({
      state: BASE.state,
      model: 'jev-1.13.0',
      questions: {
        result: {
          type: 'choice',
          instructions: 'Which team should handle this?',
          criteria: { billing: null, technical: 'Bugs and outages' },
        },
      },
    })
  })

  it('preserves structured state, instructions, and rubric descriptions', () => {
    const state = { ticket: BASE.state, retries: 3 }
    const instructions = { question: 'How frustrated is the customer?' }
    const criteria = ['Calm', { label: 'Frustrated', indicators: ['Repeated failures'] }]
    const request = prepareToolRequest(jevScoreTool, {
      ...BASE,
      state,
      instructions,
      criteria,
      model: ' jev-latest ',
    })
    expect(JSON.parse(request.body!)).toEqual({
      state,
      model: 'jev-latest',
      questions: { result: { type: 'score', instructions, criteria } },
    })
  })

  it.each([undefined, ''])('omits unset optional Noul criteria (%s)', (criteria) => {
    const request = prepareToolRequest(jevNoulTool, {
      ...BASE,
      instructions: 'Is this urgent?',
      criteria,
    })
    expect(JSON.parse(request.body!).questions.result).toEqual({
      type: 'noul',
      instructions: 'Is this urgent?',
    })
  })

  it.each([false, true])('accepts mixed batches, serialized=%s', (serialized) => {
    const questions = {
      department: { type: 'choice', instructions: 'Which team?', criteria: { billing: null } },
      urgency: { type: 'score', instructions: 'How urgent?', criteria: ['Low', 'High'] },
      escalate: { type: 'noul', instructions: 'Should a human review this?' },
    }
    const request = prepareToolRequest(jevEvaluateTool, {
      ...BASE,
      questions: serialized ? JSON.stringify(questions) : questions,
    })
    expect(JSON.parse(request.body!).questions).toEqual(questions)
  })

  it.each([
    [jevChoiceTool, { criteria: {} }],
    [
      jevChoiceTool,
      { criteria: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [i, null])) },
    ],
    [jevScoreTool, { criteria: ['Only one'] }],
    [jevScoreTool, { criteria: Array(11).fill('Too many') }],
    [jevNoulTool, { criteria: { yes: 'Unsupported key' } }],
    [jevEvaluateTool, { questions: {} }],
    [jevEvaluateTool, { questions: { invalid: { type: 'chat', instructions: 'Hello' } } }],
  ])('rejects invalid question shapes for $id', (tool, params) => {
    expect(() =>
      prepareToolRequest(tool, { ...BASE, instructions: 'Question', ...params })
    ).toThrow('Invalid Jev questions')
  })

  it('does not include malformed JSON content in validation errors', () => {
    expect(() =>
      prepareToolRequest(jevChoiceTool, {
        ...BASE,
        instructions: 'Question',
        criteria: 'private-malformed-content',
      })
    ).toThrow('Jev criteria must be valid JSON')
  })

  it('rejects non-content state values', () => {
    expect(() =>
      prepareToolRequest(jevNoulTool, { ...BASE, state: 42, instructions: 'Question' })
    ).toThrow('Jev state must be text, a JSON object, or an array')
  })

  it('returns documented single-question outputs without inventing Noul confidence', async () => {
    expect(await jevChoiceTool.transformResponse!(response({ result: CHOICE }))).toEqual({
      success: true,
      output: {
        model: 'jev-1.13.0',
        usage: USAGE,
        choice: CHOICE.choice,
        probabilities: CHOICE.probabilities,
        confidence: CHOICE.confidence,
      },
    })
    const scored = await jevScoreTool.transformResponse!(response({ result: SCORE }))
    expect(scored.output).toMatchObject({ score: 1.05, legend: SCORE.legend, confidence: 0.92 })
    expect(await jevNoulTool.transformResponse!(response({ result: NOUL }))).toEqual({
      success: true,
      output: { model: 'jev-1.13.0', usage: USAGE, noul: 0.95 },
    })
  })

  it.each([false, true])(
    'matches mixed batch answers regardless of order, serialized=%s',
    async (serialized) => {
      const answers = { department: CHOICE, frustration: SCORE, is_urgent: NOUL }
      const params = {
        ...BATCH_PARAMS,
        questions: serialized ? JSON.stringify(BATCH_PARAMS.questions) : BATCH_PARAMS.questions,
      }
      expect(
        await jevEvaluateTool.transformResponse!(
          response({ is_urgent: NOUL, frustration: SCORE, department: CHOICE }),
          params
        )
      ).toEqual({
        success: true,
        output: { model: 'jev-1.13.0', usage: USAGE, answers },
      })
    }
  )

  it.each([
    ['empty', {}],
    ['partial', { department: CHOICE, frustration: SCORE }],
    ['mismatched type', { department: NOUL, frustration: SCORE, is_urgent: NOUL }],
    ['unexpected ID', { department: CHOICE, frustration: SCORE, other: NOUL }],
    ['extra answer', { department: CHOICE, frustration: SCORE, is_urgent: NOUL, other: NOUL }],
  ])('rejects a %s batch response', async (_label, answers) => {
    await expect(
      jevEvaluateTool.transformResponse!(response(answers), BATCH_PARAMS)
    ).rejects.toThrow(
      'TypeSafe returned Jev answers that do not match the requested question IDs and types'
    )
  })

  it('requires request context to validate batch answers', async () => {
    await expect(
      jevEvaluateTool.transformResponse!(response({ department: CHOICE }))
    ).rejects.toThrow('Jev batch response validation requires request parameters')
  })

  it('supports structured Score legends documented by the TypeSafe SDK', async () => {
    const legend = { '0': { description: 'Calm' }, '1': ['Frustrated'], '2': 'Very angry' }
    const result = await jevScoreTool.transformResponse!(response({ result: { ...SCORE, legend } }))
    expect(result.output.legend).toEqual(legend)
  })

  it.each([{}, { result: NOUL }])(
    'rejects missing or mismatched Choice answers',
    async (answers) => {
      await expect(jevChoiceTool.transformResponse!(response(answers))).rejects.toThrow(
        'TypeSafe returned no Choice answer'
      )
    }
  )

  it('rejects malformed provider probabilities and usage', async () => {
    await expect(
      jevNoulTool.transformResponse!(response({ result: { type: 'noul', noul: 1.5 } }))
    ).rejects.toThrow('invalid Jev evaluation response')
    await expect(
      jevEvaluateTool.transformResponse!(Response.json({ model: 'jev-1.13.0', answers: {} }))
    ).rejects.toThrow('invalid Jev evaluation response')
  })

  it.each([false, true])(
    'projects named secrets in nested batch input, serialized=%s',
    (serialized) => {
      const secret = 'private-customer-context'
      const questions = { check: { type: 'noul', instructions: { question: secret } } }
      const projectedQuestions = {
        check: { type: 'noul', instructions: { question: '{{CONTEXT}}' } },
      }
      const input = serialized ? JSON.stringify(questions) : questions
      const projected = serialized ? JSON.stringify(projectedQuestions) : projectedQuestions
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'CONTEXT', plaintext: secret, encryptedValue: 'encrypted-context' },
      ])
      registry.recordResolvedAtInputPath('CONTEXT', secret, ['questions'])
      registry.recordResolvedInputProjection(['questions'], input, projected)
      const params = { ...BASE, questions: input }
      const request = prepareToolRequest(jevEvaluateTool, params, registry)
      expect(JSON.parse(request.body!).questions).toEqual(projectedQuestions)
      expect(request.body).not.toContain(secret)
      expect(request.headers.get('Authorization')).toBe('Bearer test-key')
      expect(params.questions).toEqual(input)
      expect(request.body).not.toContain('encrypted-context')
      expect(JSON.parse(prepareToolRequest(jevEvaluateTool, params).body!).questions).toEqual(
        questions
      )
    }
  )

  it('projects single-question criteria and preserves untracked identical text', () => {
    const criteria = { allowed: 'private-rule', denied: null }
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'RULE', plaintext: 'private-rule', encryptedValue: 'encrypted-rule' },
    ])
    registry.recordResolvedAtInputPath('RULE', 'private-rule', ['criteria'])
    registry.recordResolvedInputProjection(['criteria'], criteria, {
      allowed: '{{RULE}}',
      denied: null,
    })
    const request = prepareToolRequest(
      jevChoiceTool,
      { ...BASE, instructions: 'private-rule', criteria },
      registry
    )
    expect(JSON.parse(request.body!).questions.result).toEqual({
      type: 'choice',
      instructions: 'private-rule',
      criteria: { allowed: '{{RULE}}', denied: null },
    })
  })

  it('fails closed when the model-input provenance is incomplete', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'CONTEXT', plaintext: 'private-context', encryptedValue: 'encrypted-context' },
    ])
    registry.markIncomplete('test-incomplete')
    expect(() =>
      prepareToolRequest(jevNoulTool, { ...BASE, instructions: 'Question' }, registry)
    ).toThrow('Model input could not be safely projected')
  })
})
