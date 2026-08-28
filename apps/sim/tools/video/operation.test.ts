/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  falaiVideoTool,
  lumaVideoTool,
  minimaxVideoTool,
  runwayVideoTool,
  veoVideoTool,
} from '@/tools/video'

const TOOLS = [
  falaiVideoTool,
  lumaVideoTool,
  minimaxVideoTool,
  runwayVideoTool,
  veoVideoTool,
] as const

describe('Video operation declarations', () => {
  it.each(TOOLS)('$id exposes operation input without HTTP metadata', (tool) => {
    expect(tool.operation).toBeDefined()
    expect('request' in tool).toBe(false)
    expect(tool.operation.modelInput?.mode).toBe('project')
  })

  it('does not allow caller-supplied execution scope into operation input', () => {
    const input = runwayVideoTool.operation.input({
      provider: 'runway',
      apiKey: 'key',
      prompt: 'A cinematic sunrise',
      visualReference: {
        id: 'file-1',
        key: 'workspace/workspace-1/reference.png',
        name: 'reference.png',
        size: 5,
        type: 'image/png',
      },
      _context: {
        workspaceId: 'untrusted-workspace',
        workflowId: 'untrusted-workflow',
        executionId: 'untrusted-execution',
      },
    } as Parameters<typeof runwayVideoTool.operation.input>[0] & {
      _context: Record<string, string>
    }) as Record<string, unknown>

    expect(input).not.toHaveProperty('workspaceId')
    expect(input).not.toHaveProperty('workflowId')
    expect(input).not.toHaveProperty('executionId')
  })

  it('preserves Fal.ai hosted admission and cost tracking', () => {
    expect(falaiVideoTool.hosting).toMatchObject({
      envKeyPrefix: 'FALAI_API_KEY',
      apiKeyParam: 'apiKey',
      byokProviderId: 'falai',
      rateLimit: { mode: 'per_request', requestsPerMinute: 40 },
    })
    const input = falaiVideoTool.operation.input({
      provider: 'falai',
      apiKey: 'key',
      model: 'veo-3.1',
      prompt: 'A cinematic sunrise',
      __usingHostedKey: true,
    } as Parameters<typeof falaiVideoTool.operation.input>[0] & {
      __usingHostedKey: boolean
    })
    expect(input).toMatchObject({ useHostedCostTracking: true })
  })
})
