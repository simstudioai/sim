/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecute } = vi.hoisted(() => ({ mockExecute: vi.fn() }))

vi.mock('@/executor/handlers/workflow/workflow-handler', () => ({
  WorkflowBlockHandler: class {
    execute = mockExecute
  },
}))

import type { PiiBlockOutputRedaction } from '@/executor/execution/types'
import { runWorkflowTool } from '@/executor/handlers/workflow/workflow-tool-runner'

const PII_POLICY: PiiBlockOutputRedaction = {
  enabled: true,
  entityTypes: ['EMAIL_ADDRESS'],
  language: 'en',
}

describe('runWorkflowTool execution context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecute.mockResolvedValue({ success: true })
  })

  it("runs the child under the invoking run's environment variables", async () => {
    await runWorkflowTool(
      { workflowId: 'wf-child', _context: { workspaceId: 'ws-1' } },
      { environmentVariables: { MY_API_KEY: 'secret-value' } }
    )

    const [ctxArg] = mockExecute.mock.calls[0]
    expect(ctxArg.environmentVariables).toEqual({ MY_API_KEY: 'secret-value' })
  })

  it("forwards the invoking run's block-output redaction policy", async () => {
    await runWorkflowTool(
      { workflowId: 'wf-child', _context: { workspaceId: 'ws-1' } },
      { environmentVariables: {}, piiBlockOutputRedaction: PII_POLICY }
    )

    const [ctxArg] = mockExecute.mock.calls[0]
    expect(ctxArg.piiBlockOutputRedaction).toBe(PII_POLICY)
  })

  it('ignores an env map smuggled in through the model-reachable _context bag', async () => {
    const modelSuppliedContext = {
      workspaceId: 'ws-1',
      environmentVariables: { MY_API_KEY: 'model-injected' },
    }

    await runWorkflowTool(
      { workflowId: 'wf-child', _context: modelSuppliedContext },
      { environmentVariables: { MY_API_KEY: 'trusted' } }
    )

    const [ctxArg] = mockExecute.mock.calls[0]
    expect(ctxArg.environmentVariables).toEqual({ MY_API_KEY: 'trusted' })
  })
})
