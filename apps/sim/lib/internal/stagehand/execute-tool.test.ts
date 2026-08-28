/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agent: vi.fn(),
  extract: vi.fn(),
}))

vi.mock('@/lib/internal/stagehand/operations', () => ({
  executeStagehandAgent: mocks.agent,
  executeStagehandExtract: mocks.extract,
}))

import { executeStagehandTool } from '@/lib/internal/stagehand/execute-tool'
import { agentTool } from '@/tools/stagehand/agent'
import { extractTool } from '@/tools/stagehand/extract'

describe('Stagehand internal tool execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agent.mockResolvedValue(Response.json({ agentResult: {} }))
    mocks.extract.mockResolvedValue(Response.json({ data: {} }))
  })

  it.each([
    [
      'stagehand_agent',
      {
        task: 'Complete the task',
        startUrl: 'https://example.com',
        outputSchema: {},
        variables: {},
        provider: 'openai',
        apiKey: 'sk-test',
        mode: 'dom',
        maxSteps: 20,
      },
      mocks.agent,
    ],
    [
      'stagehand_extract',
      {
        instruction: 'Extract the title',
        schema: { type: 'object', properties: { title: { type: 'string' } } },
        provider: 'anthropic',
        apiKey: 'sk-ant-test',
        url: 'https://example.com',
      },
      mocks.extract,
    ],
  ])('dispatches %s through its typed operation', async (toolId, input, execute) => {
    await executeStagehandTool({
      toolId,
      input,
      headers: new Headers(),
      context: { userId: 'user-1' },
      requestId: 'request-1',
    })

    expect(execute).toHaveBeenCalledOnce()
  })

  it('keeps provider keys and browser configuration out of model input', () => {
    const agentParams = {
      task: 'Use %account%',
      startUrl: 'example.com',
      variables: { account: 'private' },
      outputSchema: { type: 'object' },
      provider: 'openai' as const,
      apiKey: 'sk-private',
    }
    expect(agentTool.operation.modelInput?.select(agentParams)).toEqual({
      task: 'Use %account%',
      variables: { account: 'private' },
      outputSchema: { type: 'object' },
    })
    expect(agentTool.operation.input(agentParams)).toMatchObject({
      startUrl: 'https://example.com',
      apiKey: 'sk-private',
    })

    const extractParams = {
      instruction: 'Extract',
      schema: { type: 'object' },
      provider: 'anthropic' as const,
      apiKey: 'sk-ant-private',
      url: 'https://example.com',
    }
    expect(extractTool.operation.modelInput?.select(extractParams)).toEqual({
      instruction: 'Extract',
      schema: { type: 'object' },
    })
  })

  it('uses operation-only declarations', () => {
    for (const tool of [agentTool, extractTool]) {
      expect(tool.operation).toBeDefined()
      expect('request' in tool).toBe(false)
    }
  })
})
