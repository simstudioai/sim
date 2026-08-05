/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteProviderRequest } = vi.hoisted(() => ({
  mockExecuteProviderRequest: vi.fn(),
}))

vi.mock('@/providers', () => ({
  executeProviderRequest: mockExecuteProviderRequest,
}))

vi.mock('@/providers/utils', () => ({
  getProviderFromModel: vi.fn(() => 'openai'),
}))

import { validateHallucination } from '@/lib/guardrails/validate_hallucination'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

describe('validateHallucination', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('carries the execution secret registry through the hallucination model boundary', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    const fetchMock = vi.fn(async () =>
      Response.json({ data: { results: [{ content: 'reference context' }] } })
    )
    vi.stubGlobal('fetch', fetchMock)
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({ score: 8, reasoning: 'supported' }),
      model: 'test-model',
      tokens: { input: 1, output: 1, total: 2 },
    })

    const result = await validateHallucination({
      userInput: 'secret-value __var_FOREIGN',
      knowledgeBaseId: 'kb-1',
      threshold: 3,
      topK: 10,
      model: 'test-model',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      requestId: 'request-1',
      resolvedSecretTraceRegistry: registry,
    })

    expect(result).toMatchObject({ passed: true, score: 8 })
    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: expect.stringContaining('{{TOKEN}} __var_FOREIGN'),
          }),
        ],
      }),
      { resolvedSecretTraceRegistry: registry }
    )
    const [, searchOptions] = fetchMock.mock.calls[0]
    const searchBody = JSON.parse(String(searchOptions?.body)) as { query: string }
    expect(searchBody.query).toBe('{{TOKEN}} __var_FOREIGN')
    expect(JSON.stringify(searchBody)).not.toContain('secret-value')
    expect(JSON.stringify(searchBody)).toContain('__var_FOREIGN')
  })
})
