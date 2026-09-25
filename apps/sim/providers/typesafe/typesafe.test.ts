import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getHostedModels,
  getModelCapabilities,
  getProviderDefaultModel,
  getProviderIcon,
  getProviderModels,
} from '@/providers/models'
import { PROVIDER_MAX_RETRIES } from '@/providers/transport'
import type { ProviderRequest } from '@/providers/types'
import { typesafeProvider } from '@/providers/typesafe'
import { buildJevBody, parseJevResponse } from '@/providers/typesafe/schema'
import { MAX_EVALUATION_REQUEST_BYTES, requestJevEvaluation } from '@/providers/typesafe/transport'
import type { JevEvaluationResult, JevQuestion } from '@/providers/typesafe/types'
import { getProviderFromModel, shouldBillModelUsage } from '@/providers/utils'

const QUESTIONS: Record<string, JevQuestion> = {
  department: {
    type: 'choice',
    instructions: 'Which team?',
    criteria: { billing: null, technical: 'Bugs' },
  },
  frustration: {
    type: 'score',
    instructions: 'How frustrated?',
    criteria: ['Calm', 'Frustrated', 'Angry'],
  },
  urgent: { type: 'noul', instructions: 'Is this urgent?' },
}
const RESULT: JevEvaluationResult = {
  model: 'jev-1.13.0',
  answers: {
    department: {
      type: 'choice',
      choice: 'billing',
      probabilities: { billing: 0.88, technical: 0.12 },
      confidence: 0.81,
    },
    frustration: {
      type: 'score',
      score: 1.05,
      legend: { '0': 'Calm', '1': 'Frustrated', '2': 'Angry' },
      probabilities: { '0': 0, '1': 0.95, '2': 0.05 },
      confidence: 0.92,
    },
    urgent: { type: 'noul', noul: 0.95 },
  },
  usage: { input_tokens: 318, output_tokens: 34 },
}
const REQUEST: ProviderRequest = {
  model: 'jev-1.13.0',
  apiKey: 'test-key',
  evaluation: { state: 'My payouts have been failing for three days.', questions: QUESTIONS },
}
const fetchMock = vi.fn<typeof fetch>()

describe('TypeSafe provider', () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(Response.json(RESULT))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each(['jev-1.13.0', 'jev-latest', 'jev-preview'])(
    'routes hosted-capable %s through native evaluation',
    async (model) => {
      expect(getProviderFromModel(model)).toBe('typesafe')
      expect(getHostedModels()).toContain(model)
      expect(shouldBillModelUsage(model)).toBe(true)
      expect(getModelCapabilities(model)).toMatchObject({ evaluation: true, memory: false })
      expect(getProviderIcon(model)).toBeDefined()
      const result = await typesafeProvider.executeRequest({ ...REQUEST, model })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.typesafe.ai/v1/systemone',
        expect.objectContaining({
          method: 'POST',
          redirect: 'error',
          headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, state: REQUEST.evaluation?.state, questions: QUESTIONS }),
        })
      )
      expect(result).toMatchObject({
        content: JSON.stringify(RESULT.answers),
        answers: RESULT.answers,
        model: RESULT.model,
        tokens: { input: 318, output: 34, total: 352 },
        timing: { iterations: 1, toolsTime: 0 },
      })
    }
  )

  it('defaults to the stable alias while retaining the pinned model', () => {
    expect(getProviderDefaultModel('typesafe')).toBe('jev-latest')
    expect(getProviderModels('typesafe')[0]).toBe('jev-latest')
    expect(getProviderModels('typesafe')).toContain('jev-1.13.0')
  })

  it.each(['42', 'false', 'null', { text: 'Refund required' }, ['first', { second: true }]])(
    'preserves native state %j',
    async (state) => {
      await typesafeProvider.executeRequest({
        ...REQUEST,
        evaluation: { state, questions: JSON.stringify(QUESTIONS) },
      })
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).state).toEqual(state)
    }
  )

  it('delivers complete structured answers to streaming consumers', async () => {
    const result = await typesafeProvider.executeRequest({ ...REQUEST, stream: true })
    if (!('execution' in result)) throw new Error('Expected streaming execution')
    expect(result.execution.output).toMatchObject({
      answers: RESULT.answers,
      content: JSON.stringify(RESULT.answers),
      tokens: { total: 352 },
    })
    const reader = result.stream.getReader()
    const events: unknown[] = []
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      events.push(next.value)
    }
    expect(JSON.stringify(events)).toContain('billing')
  })

  it.each([
    { apiKey: undefined },
    { evaluation: undefined },
    { messages: [{ role: 'user', content: 'Chat' }] },
    { responseFormat: { name: 'response', schema: {} } },
  ] satisfies Partial<ProviderRequest>[])(
    'rejects incomplete or conversational requests before sending them',
    async (override) => {
      await expect(typesafeProvider.executeRequest({ ...REQUEST, ...override })).rejects.toThrow()
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('does not echo upstream error bodies or credentials', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: 'private provider context test-key' }, { status: 401 })
    )
    await expect(typesafeProvider.executeRequest(REQUEST)).rejects.toThrow(
      'TypeSafe evaluation failed (HTTP 401)'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([408, 429, 500, 503])('retries HTTP %s and honors Retry-After', async (status) => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(new Response(null, { status, headers: { 'retry-after': '2' } }))
    const result = typesafeProvider.executeRequest(REQUEST)
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toMatchObject({ answers: RESULT.answers })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([400, 403, 422])('does not retry HTTP %s', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }))
    await expect(typesafeProvider.executeRequest(REQUEST)).rejects.toThrow(`HTTP ${status}`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries connection failures within the shared provider retry budget', async () => {
    vi.useFakeTimers()
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const result = expect(typesafeProvider.executeRequest(REQUEST)).rejects.toThrow('fetch failed')
    await vi.runAllTimersAsync()
    await result
    expect(fetchMock).toHaveBeenCalledTimes(PROVIDER_MAX_RETRIES + 1)
  })

  it('stops retrying repeated server failures', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async () => new Response(null, { status: 503 }))
    const result = expect(typesafeProvider.executeRequest(REQUEST)).rejects.toThrow('HTTP 503')
    await vi.runAllTimersAsync()
    await result
    expect(fetchMock).toHaveBeenCalledTimes(PROVIDER_MAX_RETRIES + 1)
  })

  it('gives a timed-out attempt a fresh deadline', async () => {
    vi.useFakeTimers()
    const deadline = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal)
    fetchMock.mockImplementationOnce(async () => {
      deadline.abort(new DOMException('Timed out', 'TimeoutError'))
      throw deadline.signal.reason
    })
    const result = typesafeProvider.executeRequest(REQUEST)
    await vi.runAllTimersAsync()
    expect(await result).toMatchObject({ answers: RESULT.answers })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1]?.signal?.aborted).toBe(false)
  })

  it('cancels immediately during Retry-After without sending another attempt', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { 'retry-after': '30' } })
    )
    const result = expect(
      typesafeProvider.executeRequest({ ...REQUEST, abortSignal: controller.signal })
    ).rejects.toThrow('Cancelled')
    await vi.advanceTimersByTimeAsync(1)
    controller.abort(new Error('Cancelled'))
    await result
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not retry a malformed successful response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{'))
    await expect(typesafeProvider.executeRequest(REQUEST)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    { label: 'ASCII values', character: 'x', bytes: 1, key: false },
    { label: 'UTF-8 values', character: '😀', bytes: 4, key: false },
    { label: 'control-character values', character: '\u0000', bytes: 6, key: false },
    { label: 'control-character keys', character: '\u0000', bytes: 6, key: true },
    { label: 'lone-surrogate values', character: '\ud800', bytes: 6, key: false },
    { label: 'lone-surrogate keys', character: '\ud800', bytes: 6, key: true },
  ])('rejects oversized $label before serialization or HTTP', async ({ character, bytes, key }) => {
    const text = character.repeat(Math.ceil(MAX_EVALUATION_REQUEST_BYTES / bytes))
    const body = {
      model: REQUEST.model,
      state: key ? { [text]: null } : text,
      questions: QUESTIONS,
    }
    const serialize = vi.spyOn(JSON, 'stringify')
    await expect(requestJevEvaluation(body, 'test-key')).rejects.toThrow(
      'size or JSON complexity limit'
    )
    expect(serialize).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('honors cancellation before network access', async () => {
    await expect(
      typesafeProvider.executeRequest({ ...REQUEST, abortSignal: AbortSignal.abort() })
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards cancellation to the request and bounds response allocation', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(async (_url, init) => {
      controller.abort()
      expect(init?.signal?.aborted).toBe(true)
      throw controller.signal.reason
    })
    await expect(
      typesafeProvider.executeRequest({ ...REQUEST, abortSignal: controller.signal })
    ).rejects.toThrow()
    fetchMock.mockResolvedValue(
      new Response('{}', { headers: { 'content-length': String(11 * 1024 * 1024) } })
    )
    await expect(typesafeProvider.executeRequest(REQUEST)).rejects.toThrow('exceeds maximum size')
  })
})

describe('Jev native schema', () => {
  it.each([
    {},
    { bad: { type: 'chat', instructions: 'Hello' } },
    { bad: { type: 'choice', instructions: 'Pick', criteria: {} } },
    {
      bad: {
        type: 'choice',
        instructions: 'Pick',
        criteria: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [String(i), null])),
      },
    },
    { bad: { type: 'score', instructions: 'Rate', criteria: ['One'] } },
    { bad: { type: 'score', instructions: 'Rate', criteria: Array(11).fill('Level') } },
    { bad: { type: 'noul', instructions: 'Test', criteria: { yes: 'Wrong key' } } },
  ])('rejects invalid question shape %j', (questions) => {
    expect(() => buildJevBody({ model: REQUEST.model, state: 'Test' }, questions)).toThrow(
      'Invalid Jev questions'
    )
  })

  it.each([null, true, 42])('rejects invalid state %j', (state) => {
    expect(() => buildJevBody({ model: REQUEST.model, state }, QUESTIONS)).toThrow('Jev state')
  })

  it('accepts structured instructions and all question types together', () => {
    expect(
      buildJevBody(
        { model: REQUEST.model, state: { content: 'Test' } },
        {
          ...QUESTIONS,
          urgent: {
            type: 'noul',
            instructions: ['Is this urgent?'],
            criteria: { true: { deadline: 'today' }, false: 'No deadline' },
          },
        }
      ).questions.urgent.instructions
    ).toEqual(['Is this urgent?'])
  })

  it('rejects malformed question JSON', () => {
    expect(() => buildJevBody({ model: REQUEST.model, state: 'Test' }, '{')).toThrow('valid JSON')
  })

  it.each([
    {},
    { ...RESULT.answers, unexpected: { type: 'noul', noul: 0.1 } },
    { ...RESULT.answers, department: { type: 'noul', noul: 0.1 } },
  ])('rejects mismatched answer IDs or types', (answers) => {
    expect(() => parseJevResponse({ ...RESULT, answers }, QUESTIONS)).toThrow('do not match')
  })

  it.each([
    { ...RESULT, usage: { input_tokens: -1, output_tokens: 0 } },
    { ...RESULT, answers: { urgent: { type: 'noul', noul: 1.1 } } },
    { model: 'jev-1.13.0', choices: [] },
  ])('rejects invalid provider responses', (value) => {
    expect(() => parseJevResponse(value, QUESTIONS)).toThrow('invalid Jev evaluation response')
  })

  it.each(['unknown', 'toString'])('rejects an unrequested Choice option %s', (choice) => {
    const answers = {
      ...RESULT.answers,
      department: { type: 'choice', choice, probabilities: { [choice]: 1 }, confidence: 1 },
    }
    expect(() => parseJevResponse({ ...RESULT, answers }, QUESTIONS)).toThrow(
      'outside the requested options'
    )
  })
})
