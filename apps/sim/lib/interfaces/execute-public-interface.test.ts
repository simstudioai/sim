import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLoadDeployed = vi.fn()
const mockExecuteDeployedAction = vi.fn()
const mockResolveApiStart = vi.fn()
const mockValidateSpec = vi.fn()
const mockBuildPayload = vi.fn()

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadDeployedWorkflowState: (...args: unknown[]) => mockLoadDeployed(...args),
}))

vi.mock('@/lib/apps/execute-deployed-action', () => ({
  executeDeployedAction: (...args: unknown[]) => mockExecuteDeployedAction(...args),
}))

vi.mock('@/lib/interfaces/spec/api-start-input', () => ({
  resolveApiStartInput: (...args: unknown[]) => mockResolveApiStart(...args),
}))

vi.mock('@/lib/interfaces', () => ({
  validateInterfaceSpec: (...args: unknown[]) => mockValidateSpec(...args),
  buildExecutePayload: (...args: unknown[]) => mockBuildPayload(...args),
  buildInterfaceExecuteResponse: (value: unknown) => value,
  toPublicSafeError: (message: string) => message,
  toPublicSafeInputError: (message: string) => message,
  workflowHasHitlBlocks: () => false,
}))

describe('executePublicInterfaceAction (active gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns needs-republishing when active deployment cannot load', async () => {
    mockLoadDeployed.mockRejectedValue(new Error('missing'))
    const { executePublicInterfaceAction } = await import(
      '@/lib/interfaces/execute-public-interface'
    )
    const result = await executePublicInterfaceAction({
      workflowId: 'wf',
      userId: 'u',
      workspaceId: 'ws',
      spec: { version: 1, actions: [] } as never,
      outputConfigs: [],
      actionId: 'a',
      values: {},
      requestId: 'r1',
    })
    expect(result).toEqual({
      success: false,
      status: 409,
      message: 'Interface needs republishing',
    })
    expect(mockExecuteDeployedAction).not.toHaveBeenCalled()
  })

  it('calls executeDeployedAction with deploymentGate active', async () => {
    mockLoadDeployed.mockResolvedValue({
      blocks: { start: { type: 'api_trigger' } },
      edges: [],
      loops: {},
      parallels: {},
      deploymentVersionId: 'dv1',
    })
    mockResolveApiStart.mockReturnValue({ ok: true, data: { fields: [] } })
    mockValidateSpec.mockReturnValue({ success: true, spec: { actions: [{ id: 'a' }] } })
    mockBuildPayload.mockReturnValue({ success: true, payload: { name: 'Ada' } })
    mockExecuteDeployedAction.mockResolvedValue({
      success: true,
      executionId: 'ex1',
      status: 'completed',
      outputs: { success: true },
      rawResult: { success: true, logs: [], output: {} },
    })

    const { executePublicInterfaceAction } = await import(
      '@/lib/interfaces/execute-public-interface'
    )
    const result = await executePublicInterfaceAction({
      workflowId: 'wf',
      userId: 'u',
      workspaceId: 'ws',
      spec: { version: 1, actions: [{ id: 'a' }] } as never,
      outputConfigs: [],
      actionId: 'a',
      values: { name: 'Ada' },
      requestId: 'r1',
    })

    expect(result.success).toBe(true)
    expect(mockExecuteDeployedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentGate: 'active',
        triggerIdentity: 'interface',
        workflowId: 'wf',
      })
    )
  })
})
