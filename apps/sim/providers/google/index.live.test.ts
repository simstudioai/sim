import { writeFile } from 'node:fs/promises'
import { getErrorMessage } from '@sim/utils/errors'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StreamingExecution } from '@/executor/types'
import { executeProviderRequest } from '@/providers'
import type { ProviderRequest, ProviderResponse } from '@/providers/types'

vi.unmock('@/tools/registry')
vi.unmock('@/tools/metadata')
vi.unmock('@/tools/metadata-outputs')

const model = process.env.GEMINI_LIVE_MODEL || 'gemini-4-argon'
const apiKey = process.env.GEMINI_API_KEY
const reportPath = process.env.GEMINI_REPORT_PATH
const results: Array<{
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}> = []

async function check(name: string, run: () => Promise<void>) {
  const start = Date.now()
  try {
    await run()
    results.push({ name, status: 'passed', durationMs: Date.now() - start })
  } catch (error) {
    results.push({
      name,
      status: 'failed',
      durationMs: Date.now() - start,
      error: getErrorMessage(error),
    })
    throw error
  }
}

async function execute(request: Partial<ProviderRequest> = {}) {
  expect(vi.isMockFunction(globalThis.fetch)).toBe(false)
  return executeProviderRequest('google', {
    model,
    apiKey,
    maxTokens: 65536,
    thinkingLevel: 'low',
    abortSignal: AbortSignal.timeout(120_000),
    messages: [{ role: 'user', content: 'Reply with only the result of 6 times 7.' }],
    ...request,
  })
}

beforeAll(() => {
  if (!apiKey) throw new Error('Set GEMINI_API_KEY to a Gemini API key with model access')
  if (!reportPath) throw new Error('Set GEMINI_REPORT_PATH to a writable JSON report path')
})

afterAll(async () => {
  if (reportPath) {
    await writeFile(
      reportPath,
      JSON.stringify({ model, recordedAt: new Date().toISOString(), results }, null, 2)
    )
  }
})

describe('Google Gemini live acceptance', () => {
  it.each(['low', 'medium', 'high'])(
    'answers with %s thinking',
    async (thinkingLevel) => {
      await check(`thinking:${thinkingLevel}`, async () => {
        const result = (await execute({ thinkingLevel })) as ProviderResponse
        expect(result.content.trim()).toBe('42')
        expect(result.tokens?.total).toBeGreaterThan(0)
        expect(result.cost?.total).toBeGreaterThan(0)
      })
    },
    120_000
  )

  it('returns a native JSON-schema answer', async () => {
    await check('structured-output', async () => {
      const result = (await execute({
        responseFormat: {
          name: 'answer',
          schema: {
            type: 'object',
            properties: { answer: { type: 'integer' } },
            required: ['answer'],
            additionalProperties: false,
          },
        },
      })) as ProviderResponse
      expect(JSON.parse(result.content)).toEqual({ answer: 42 })
    })
  }, 120_000)

  it('reads an inline image through the attachment pipeline', async () => {
    await check('vision', async () => {
      const base64 =
        'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC'
      const result = (await execute({
        messages: [
          {
            role: 'user',
            content: 'What is the dominant color in this image? Reply with one color word.',
            files: [
              {
                id: 'inline-fixture',
                name: 'fixture.png',
                url: '',
                key: '',
                type: 'image/png',
                size: Buffer.from(base64, 'base64').length,
                base64,
              },
            ],
          },
        ],
      })) as ProviderResponse
      expect(result.content.toLowerCase()).toContain('red')
      expect(result.tokens?.total).toBeGreaterThan(0)
    })
  }, 120_000)

  it('streams answer events and settles usage', async () => {
    await check('stream', async () => {
      const result = (await execute({ stream: true, agentEvents: true })) as StreamingExecution
      const reader = result.stream.getReader()
      while (!(await reader.read()).done) {}
      const execution = await result.execution
      expect(execution.output.content?.trim()).toBe('42')
      expect(execution.output.tokens?.total).toBeGreaterThan(0)
      expect(execution.output.cost?.total).toBeGreaterThan(0)
    })
  }, 120_000)

  it.each([false, true])(
    'returns structured output after a real HTTP tool (stream=%s)',
    async (stream) => {
      await check(`structured-tool-loop:stream=${stream}`, async () => {
        const result = await execute({
          stream,
          agentEvents: stream,
          messages: [
            {
              role: 'user',
              content:
                'Fetch https://example.com with the tool, then return its HTTP status as status.',
            },
          ],
          tools: [
            {
              id: 'http_request',
              description: 'Fetch the example page',
              usageControl: 'force',
              params: { url: 'https://example.com', method: 'GET' },
              parameters: { type: 'object', properties: {}, required: [] },
            },
          ],
          responseFormat: {
            name: 'status',
            schema: {
              type: 'object',
              properties: { status: { type: 'integer' } },
              required: ['status'],
              additionalProperties: false,
            },
          },
        })
        if (stream) {
          const streaming = result as StreamingExecution
          const reader = streaming.stream.getReader()
          while (!(await reader.read()).done) {}
          const execution = await streaming.execution
          expect(JSON.parse(execution.output.content ?? '')).toEqual({ status: 200 })
          expect(
            execution.output.toolCalls?.list.find((call) => call.name === 'http_request')?.result
          ).toMatchObject({ status: 200 })
        } else {
          const response = result as ProviderResponse
          expect(JSON.parse(response.content)).toEqual({ status: 200 })
          expect(
            response.toolCalls?.find((call) => call.name === 'http_request')?.result
          ).toMatchObject({ status: 200 })
        }
      })
    },
    120_000
  )
})
