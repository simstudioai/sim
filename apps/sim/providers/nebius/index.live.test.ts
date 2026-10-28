import { writeFile } from 'node:fs/promises'
import { getErrorMessage } from '@sim/utils/errors'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StreamingExecution } from '@/executor/types'
import { executeProviderRequest } from '@/providers'
import { getProviderModels } from '@/providers/models'
import type { ProviderRequest, ProviderResponse } from '@/providers/types'

vi.unmock('@/tools/registry')
vi.unmock('@/tools/metadata')
vi.unmock('@/tools/metadata-outputs')

const results: Array<{
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}> = []
const apiKey = process.env.NEBIUS_API_KEY
const reportPath = process.env.NEBIUS_REPORT_PATH
const model = 'nebius/Qwen/Qwen3-30B-A3B-Instruct-2507'

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
  return executeProviderRequest('nebius', {
    model,
    apiKey,
    temperature: 0,
    maxTokens: 128,
    abortSignal: AbortSignal.timeout(90_000),
    messages: [{ role: 'user', content: 'Reply with only the result of 6 times 7.' }],
    ...request,
  })
}

beforeAll(async () => {
  await check('configuration', async () => {
    if (!reportPath) throw new Error('Set NEBIUS_REPORT_PATH to a writable JSON report path')
    if (!apiKey) throw new Error('Set NEBIUS_API_KEY to a funded Nebius Token Factory key')
  })
})

afterAll(async () => {
  if (reportPath)
    await writeFile(
      reportPath,
      JSON.stringify({ recordedAt: new Date().toISOString(), results }, null, 2)
    )
})

describe('Nebius live acceptance', () => {
  it('rejects invalid credentials over the real API', async () => {
    await check('invalid-credentials', async () => {
      await expect(execute({ apiKey: 'invalid-nebius-test-key' })).rejects.toThrow('401')
    })
  }, 60_000)

  it.each(getProviderModels('nebius'))(
    'serves catalog model %s',
    async (catalogModel) => {
      await check(`catalog:${catalogModel}`, async () => {
        const result = (await execute({ model: catalogModel, maxTokens: 2048 })) as ProviderResponse
        expect(result.content).toContain('42')
        expect(result.tokens?.total).toBeGreaterThan(0)
        expect(result.model).toBe(catalogModel)
        expect(result.cost?.total).toBe(0)
      })
    },
    120_000
  )

  it('serves the lowercase model ID emitted by the picker', async () => {
    await check('picker-model-id', async () => {
      const result = (await execute({ model: model.toLowerCase() })) as ProviderResponse
      expect(result.content).toContain('42')
      expect(result.tokens?.total).toBeGreaterThan(0)
    })
  }, 60_000)

  it('reads an inline image through the attachment pipeline', async () => {
    await check('vision', async () => {
      const base64 =
        'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC'
      const result = (await execute({
        model: 'nebius/openbmb/MiniCPM-V-4_5',
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
  }, 60_000)

  it('streams the answer and final usage', async () => {
    await check('stream', async () => {
      const result = (await execute({ stream: true })) as StreamingExecution
      const reader = result.stream.getReader()
      while (!(await reader.read()).done) {}
      const execution = await result.execution
      expect(execution.output.content).toContain('42')
      expect(execution.output.tokens?.total).toBeGreaterThan(0)
      expect(execution.output.cost?.total).toBe(0)
    })
  }, 60_000)

  it.each([
    { name: 'native', model },
    { name: 'prompt-fallback', model: 'nebius/Qwen/Qwen3.5-397B-A17B' },
  ])(
    'returns a JSON-schema answer through $name',
    async (scenario) => {
      await check(`structured-output:${scenario.name}`, async () => {
        const result = (await execute({
          model: scenario.model,
          maxTokens: 2048,
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
    },
    60_000
  )

  it('streams an HTTP tool execution and its final answer', async () => {
    await check('streamed-tool-loop', async () => {
      const result = (await execute({
        stream: true,
        messages: [
          {
            role: 'user',
            content: 'Fetch https://example.com using the tool, then report the HTTP status code.',
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
      })) as StreamingExecution
      const reader = result.stream.getReader()
      while (!(await reader.read()).done) {}
      const execution = await result.execution
      expect(execution.output.toolCalls?.list.some((call) => call.success)).toBe(true)
      expect(execution.output.content).toContain('200')
      expect(execution.output.tokens?.total).toBeGreaterThan(0)
      expect(execution.output.cost?.total).toBe(0)
    })
  }, 120_000)

  it('executes an HTTP tool and feeds its result back into the answer', async () => {
    await check('tool-loop', async () => {
      const result = (await execute({
        messages: [
          {
            role: 'user',
            content: 'Fetch https://example.com using the tool, then report the HTTP status code.',
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
      })) as ProviderResponse
      expect(result.toolCalls?.some((call) => call.name === 'http_request' && call.success)).toBe(
        true
      )
      expect(result.content).toContain('200')
    })
  }, 120_000)
})
