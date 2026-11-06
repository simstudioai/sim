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
const apiKey = process.env.THINKINGMACHINES_API_KEY
const reportPath = process.env.THINKINGMACHINES_REPORT_PATH
const model = 'thinkingmachines/inkling-2-small'

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
  return executeProviderRequest('thinkingmachines', {
    model,
    apiKey,
    temperature: 0,
    maxTokens: 2048,
    abortSignal: AbortSignal.timeout(90_000),
    messages: [{ role: 'user', content: 'Reply with only the result of 6 times 7.' }],
    ...request,
  })
}

beforeAll(async () => {
  await check('configuration', async () => {
    if (!reportPath)
      throw new Error('Set THINKINGMACHINES_REPORT_PATH to a writable JSON report path')
    if (!apiKey) throw new Error('Set THINKINGMACHINES_API_KEY to a funded Tinker API key')
  })
})

afterAll(async () => {
  if (reportPath)
    await writeFile(
      reportPath,
      JSON.stringify({ recordedAt: new Date().toISOString(), results }, null, 2)
    )
})

describe('Thinking Machines live acceptance', () => {
  it('rejects invalid credentials over the real API', async () => {
    await check('invalid-credentials', async () => {
      await expect(execute({ apiKey: 'invalid-tinker-test-key' })).rejects.toThrow(/401|403/)
    })
  }, 60_000)

  it.each(getProviderModels('thinkingmachines'))(
    'serves catalog model %s',
    async (catalogModel) => {
      await check(`catalog:${catalogModel}`, async () => {
        const result = (await execute({ model: catalogModel })) as ProviderResponse
        expect(result.content).toContain('42')
        expect(result.content).not.toMatch(/<think|<\/think>/i)
        expect(result.tokens?.total).toBeGreaterThan(0)
        expect(result.model).toBe(catalogModel)
      })
    },
    120_000
  )

  it('streams the answer and final usage', async () => {
    await check('stream', async () => {
      const result = (await execute({ stream: true })) as StreamingExecution
      const reader = result.stream.getReader()
      while (!(await reader.read()).done) {}
      const execution = await result.execution
      expect(execution.output.content).toContain('42')
      expect(execution.output.tokens?.total).toBeGreaterThan(0)
    })
  }, 60_000)

  it('returns a JSON-schema answer through the prompt fallback', async () => {
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
  }, 60_000)

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
            usageControl: 'auto',
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
