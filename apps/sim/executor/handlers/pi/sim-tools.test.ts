/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockTransformBlockTool, mockExecuteTool } = vi.hoisted(() => ({
  mockTransformBlockTool: vi.fn(),
  mockExecuteTool: vi.fn(),
}))

vi.mock('@/providers/utils', () => ({ transformBlockTool: mockTransformBlockTool }))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))
vi.mock('@/tools/utils', () => ({ getTool: vi.fn() }))
vi.mock('@/tools/utils.server', () => ({ getToolAsync: vi.fn() }))

import { buildSimToolSpecs } from '@/executor/handlers/pi/sim-tools'
import type { ExecutionContext } from '@/executor/types'

const ctx = { workspaceId: 'ws-1' } as ExecutionContext

describe('buildSimToolSpecs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names the Pi tool with the snake_case tool id, not the human label', async () => {
    // transformBlockTool returns a human label with a space, which the model
    // provider rejects (tool names must match /^[a-zA-Z0-9_-]{1,128}$/).
    mockTransformBlockTool.mockResolvedValue({
      id: 'exa_search',
      name: 'Exa Search',
      description: 'Search the web',
      params: {},
      parameters: { type: 'object', properties: {} },
    })

    const specs = await buildSimToolSpecs(ctx, [
      { type: 'exa', operation: 'exa_search', usageControl: 'auto' },
    ])

    expect(specs).toHaveLength(1)
    expect(specs[0].name).toBe('exa_search')
    expect(specs[0].name).toMatch(/^[a-zA-Z0-9_-]{1,128}$/)
  })

  it('skips mcp, custom, and usage-none tools without adapting them', async () => {
    const specs = await buildSimToolSpecs(ctx, [
      { type: 'mcp', usageControl: 'auto' },
      { type: 'custom-tool', usageControl: 'auto' },
      { type: 'exa', usageControl: 'none' },
    ])

    expect(specs).toHaveLength(0)
    expect(mockTransformBlockTool).not.toHaveBeenCalled()
  })

  it('forwards a trusted _context that an LLM-supplied _context cannot override', async () => {
    mockTransformBlockTool.mockResolvedValue({
      id: 'exa_search',
      name: 'Exa Search',
      description: 'Search the web',
      params: { apiKey: 'k' },
      parameters: { type: 'object', properties: {} },
    })
    mockExecuteTool.mockResolvedValue({ success: true, output: 'ok' })
    const trustedCtx = {
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      userId: 'user-1',
    } as ExecutionContext

    const [spec] = await buildSimToolSpecs(trustedCtx, [
      { type: 'exa', operation: 'exa_search', usageControl: 'auto' },
    ])
    // An attacker-influenced tool arg tries to spoof the execution context.
    await spec.execute({ query: 'cats', _context: { userId: 'attacker', workspaceId: 'evil' } })

    const [toolId, callParams] = mockExecuteTool.mock.calls[0]
    expect(toolId).toBe('exa_search')
    expect(callParams._context.userId).toBe('user-1')
    expect(callParams._context.workspaceId).toBe('ws-1')
    expect(callParams._context.workflowId).toBe('wf-1')
  })
})
