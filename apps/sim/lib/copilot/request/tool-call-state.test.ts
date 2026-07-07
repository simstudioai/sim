/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { MothershipStreamV1ToolOutcome } from '@/lib/copilot/generated/mothership-stream-v1'
import type { ToolCallState } from '@/lib/copilot/request/types'
import { getToolCallTerminalData } from './tool-call-state'

describe('getToolCallTerminalData', () => {
  it('reduces a successful generate_api_key result to only its status message', () => {
    const tool: ToolCallState = {
      id: 't1',
      name: 'generate_api_key',
      status: MothershipStreamV1ToolOutcome.success,
      result: {
        success: true,
        output: {
          id: 'k1',
          name: 'prod',
          key: 'sk-sim-secret-value',
          message: 'API key "prod" created.',
        },
      },
    }

    const data = getToolCallTerminalData(tool)

    // The model gets only the status message — no key, no id/name/workspaceId.
    expect(data).toBe('API key "prod" created.')
    expect(JSON.stringify(data)).not.toContain('sk-sim-secret-value')
    expect(JSON.stringify(data)).not.toContain('k1')
  })

  it('passes through other tools output unchanged', () => {
    const tool: ToolCallState = {
      id: 't2',
      name: 'read',
      status: MothershipStreamV1ToolOutcome.success,
      result: { success: true, output: { content: 'file contents' } },
    }

    expect(getToolCallTerminalData(tool)).toEqual({ content: 'file contents' })
  })

  it('surfaces the error for a failed generate_api_key without inventing a key', () => {
    const tool: ToolCallState = {
      id: 't3',
      name: 'generate_api_key',
      status: MothershipStreamV1ToolOutcome.error,
      error: 'name is required',
    }

    expect(getToolCallTerminalData(tool)).toEqual({ error: 'name is required' })
  })
})
