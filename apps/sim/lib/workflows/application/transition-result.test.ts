/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireWorkflowTransition } from '@/lib/workflows/application/transition-result'

describe('requireWorkflowTransition', () => {
  it('returns without throwing for a successful transition', () => {
    expect(() => requireWorkflowTransition({ success: true }, 'Failed')).not.toThrow()
  })

  it('withholds the raw message a failed lifecycle transition carries', () => {
    expect(() =>
      requireWorkflowTransition(
        {
          success: false,
          error: 'duplicate key value violates unique constraint "workflow_pkey"',
          errorCode: 'internal',
        },
        'Failed to create workflow'
      )
    ).toThrow('Failed to create workflow')
  })

  it('preserves a classified failure so the route maps the right status', () => {
    try {
      requireWorkflowTransition(
        { success: false, error: 'No such workflow', errorCode: 'not_found' },
        'Failed to delete workflow'
      )
      expect.unreachable('expected requireWorkflowTransition to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(OrchestrationError)
      expect((error as OrchestrationError).code).toBe('not_found')
      expect((error as OrchestrationError).message).toBe('No such workflow')
    }
  })
})
