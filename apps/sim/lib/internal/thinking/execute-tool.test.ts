/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { executeThinkingTool } from '@/lib/internal/thinking/execute-tool'

const context = {
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
}

describe('executeThinkingTool', () => {
  it('returns the acknowledged thought from semantic operation input', async () => {
    const response = await executeThinkingTool({
      toolId: 'thinking_tool',
      input: { thought: 'Consider the edge cases' },
      headers: new Headers(),
      context,
      requestId: 'request-1',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      output: { acknowledgedThought: 'Consider the edge cases' },
    })
  })

  it('rejects invalid operation input', async () => {
    const response = await executeThinkingTool({
      toolId: 'thinking_tool',
      input: { thought: '' },
      headers: new Headers(),
      context,
      requestId: 'request-1',
    })

    expect(response.status).toBe(400)
  })
})
