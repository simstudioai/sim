import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agent: vi.fn(),
  extract: vi.fn(),
}))

vi.mock('@/lib/internal/stagehand/operations', () => ({
  executeStagehandAgent: mocks.agent,
  executeStagehandExtract: mocks.extract,
}))

import { agentTool } from '@/tools/stagehand/agent'
import { extractTool } from '@/tools/stagehand/extract'

describe('Stagehand internal tool execution', () => {
  beforeEach(() => {
    mocks.agent.mockResolvedValue(Response.json({ agentResult: {} }))
    mocks.extract.mockResolvedValue(Response.json({ data: {} }))
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
})
