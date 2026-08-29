/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createInternalToolOperationInput } from '@/tools/operation-input'

describe('createInternalToolOperationInput', () => {
  it('keeps resolved tool values and removes executor context from semantic input', () => {
    const context = {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    }
    const params = {
      prompt: 'resolved secret and <block.output>',
      nested: { value: 42 },
      _context: context,
    }

    expect(createInternalToolOperationInput(params)).toEqual({
      prompt: 'resolved secret and <block.output>',
      nested: { value: 42 },
    })
    expect(params._context).toBe(context)
  })
})
