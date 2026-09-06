/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  mergeFailedStructuredAttempt,
  shouldEnforceStructuredOutput,
  validateStructuredOutput,
} from '@/executor/handlers/agent/structured-output'
import type { ProviderResponse } from '@/providers/types'

/**
 * Mirrors the extraction-pipeline schema whose violations motivated this
 * module: a required enum, a bounded importance score, and a non-empty text
 * field — constraints that native structured output grammars demote to
 * advisory prose and prompt-based models never had enforced at all.
 */
const OBSERVATION_FORMAT = {
  name: 'response_schema',
  schema: {
    type: 'object',
    properties: {
      observations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['fact', 'decision', 'question'] },
            text: { type: 'string', minLength: 1 },
            importance: { type: 'number', minimum: 1, maximum: 10 },
          },
          required: ['type', 'text', 'importance'],
        },
      },
    },
    required: ['observations'],
  },
  strict: true,
}

function makeResponse(overrides: Partial<ProviderResponse>): ProviderResponse {
  return {
    content: '',
    model: 'mock-model',
    tokens: { input: 10, output: 20, total: 30 },
    ...overrides,
  }
}

describe('shouldEnforceStructuredOutput', () => {
  it('enforces when strict is true', () => {
    expect(shouldEnforceStructuredOutput(OBSERVATION_FORMAT)).toBe(true)
  })

  it('enforces when strict is absent, matching the documented default', () => {
    expect(shouldEnforceStructuredOutput({ name: 'x', schema: { type: 'object' } })).toBe(true)
  })

  it('does not enforce when strict is false', () => {
    expect(shouldEnforceStructuredOutput({ ...OBSERVATION_FORMAT, strict: false })).toBe(false)
  })

  it('does not enforce without a response format', () => {
    expect(shouldEnforceStructuredOutput(undefined)).toBe(false)
    expect(shouldEnforceStructuredOutput('')).toBe(false)
  })
})

describe('validateStructuredOutput', () => {
  it('accepts a conforming response', () => {
    const verdict = validateStructuredOutput(
      makeResponse({
        content: '{"observations":[{"type":"fact","text":"Staging is green.","importance":7}]}',
      }),
      OBSERVATION_FORMAT
    )
    expect(verdict).toEqual({
      ok: true,
      output: { observations: [{ type: 'fact', text: 'Staging is green.', importance: 7 }] },
    })
  })

  it('rescues valid JSON wrapped in a Markdown code fence', () => {
    const verdict = validateStructuredOutput(
      makeResponse({
        content: '```json\n{"observations":[{"type":"fact","text":"Fenced.","importance":3}]}\n```',
      }),
      OBSERVATION_FORMAT
    )
    expect(verdict.ok).toBe(true)
  })

  it('rejects unparseable content, as produced by truncated JSON', () => {
    const verdict = validateStructuredOutput(
      makeResponse({ content: '{"observations":[{"type":"fact","text":"cut of' }),
      OBSERVATION_FORMAT
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('expected failure')
    expect(verdict.reason).toContain('not valid JSON')
  })

  it('rejects empty content', () => {
    const verdict = validateStructuredOutput(makeResponse({ content: '' }), OBSERVATION_FORMAT)
    expect(verdict.ok).toBe(false)
  })

  it('rejects a hollow row violating the authored enum and bounds', () => {
    const verdict = validateStructuredOutput(
      makeResponse({
        content: '{"observations":[{"type":"","text":"","importance":0}]}',
      }),
      OBSERVATION_FORMAT
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('expected failure')
    expect(verdict.reason).toContain('violates the configured schema')
    expect(verdict.reason).toContain('/observations/0/type')
  })

  it('rejects a JSON root that is not an object', () => {
    const verdict = validateStructuredOutput(makeResponse({ content: '[1,2,3]' }), {
      name: 'x',
      strict: true,
    })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('expected failure')
    expect(verdict.reason).toContain('not a JSON object')
  })

  it('rejects a response that stopped at the output token limit even when it parses', () => {
    const verdict = validateStructuredOutput(
      makeResponse({
        content: '{"observations":[]}',
        timing: {
          startTime: 't0',
          endTime: 't1',
          duration: 5,
          timeSegments: [
            { type: 'model', name: 'first', startTime: 0, endTime: 1, duration: 1 },
            {
              type: 'model',
              name: 'final',
              startTime: 1,
              endTime: 2,
              duration: 1,
              finishReason: 'MAX_TOKENS',
            },
          ],
        },
      }),
      OBSERVATION_FORMAT
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('expected failure')
    expect(verdict.reason).toContain('output token limit')
  })

  it('treats the OpenAI-family length finish reason as truncation', () => {
    const verdict = validateStructuredOutput(
      makeResponse({
        content: '{"observations":[]}',
        timing: {
          startTime: 't0',
          endTime: 't1',
          duration: 5,
          timeSegments: [
            {
              type: 'model',
              name: 'final',
              startTime: 0,
              endTime: 1,
              duration: 1,
              finishReason: 'length',
            },
          ],
        },
      }),
      OBSERVATION_FORMAT
    )
    expect(verdict.ok).toBe(false)
  })

  it('accepts a normal stop finish reason', () => {
    const verdict = validateStructuredOutput(
      makeResponse({
        content: '{"observations":[]}',
        timing: {
          startTime: 't0',
          endTime: 't1',
          duration: 5,
          timeSegments: [
            {
              type: 'model',
              name: 'final',
              startTime: 0,
              endTime: 1,
              duration: 1,
              finishReason: 'end_turn',
            },
          ],
        },
      }),
      OBSERVATION_FORMAT
    )
    expect(verdict.ok).toBe(true)
  })

  it('falls back to parse-only checks when the schema does not compile', () => {
    const uncompilable = {
      name: 'x',
      schema: { type: 'object', properties: { a: { type: 'no-such-type' } } },
      strict: true,
    }
    const verdict = validateStructuredOutput(
      makeResponse({ content: '{"a":"anything"}' }),
      uncompilable
    )
    expect(verdict.ok).toBe(true)
  })

  it('validates against a bare schema without the wrapper shape', () => {
    const verdict = validateStructuredOutput(makeResponse({ content: '{"answer":2}' }), {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    })
    expect(verdict.ok).toBe(false)
  })
})

describe('mergeFailedStructuredAttempt', () => {
  it('folds tokens, cost, and trace segments of the failed attempt into the response', () => {
    const failedSegment = {
      type: 'model',
      name: 'failed',
      startTime: 0,
      endTime: 1,
      duration: 1,
    }
    const finalSegment = { type: 'model', name: 'final', startTime: 2, endTime: 3, duration: 1 }
    const pricing = { input: 1, output: 2, updatedAt: '2026-01-01' }
    const response = makeResponse({
      tokens: { input: 10, output: 20, total: 30 },
      cost: { input: 0.1, output: 0.2, total: 0.3, pricing },
      timing: {
        startTime: 't1',
        endTime: 't2',
        duration: 50,
        timeSegments: [finalSegment],
      },
    })
    const failed = makeResponse({
      tokens: { input: 5, output: 100, total: 105 },
      cost: { input: 0.05, output: 1, total: 1.05, pricing },
      timing: {
        startTime: 't0',
        endTime: 't1',
        duration: 30,
        timeSegments: [failedSegment],
      },
    })

    mergeFailedStructuredAttempt(response, failed)

    expect(response.tokens).toEqual({ input: 15, output: 120, total: 135 })
    expect(response.cost?.input).toBeCloseTo(0.15)
    expect(response.cost?.output).toBeCloseTo(1.2)
    expect(response.cost?.total).toBeCloseTo(1.35)
    expect(response.timing).toMatchObject({ startTime: 't0', duration: 80 })
    expect(response.timing?.timeSegments).toEqual([failedSegment, finalSegment])
  })

  it('adopts the failed attempt cost when the final response has none', () => {
    const pricing = { input: 1, output: 2, updatedAt: '2026-01-01' }
    const response = makeResponse({ tokens: undefined })
    const failed = makeResponse({
      tokens: { input: 5, output: 6, total: 11 },
      cost: { input: 0.05, output: 0.06, total: 0.11, pricing },
    })

    mergeFailedStructuredAttempt(response, failed)

    expect(response.tokens).toEqual({ input: 5, output: 6, total: 11 })
    expect(response.cost).toMatchObject({ total: 0.11 })
  })
})
