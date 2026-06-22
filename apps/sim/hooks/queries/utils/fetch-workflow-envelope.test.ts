/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

vi.mock('@/lib/api/contracts/workflows', () => ({
  getWorkflowStateContract: { __contract: 'getWorkflowState' },
}))

import { fetchWorkflowEnvelope } from '@/hooks/queries/utils/fetch-workflow-envelope'

describe('fetchWorkflowEnvelope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the unwrapped envelope from the contract response', async () => {
    const envelope = {
      id: 'wf-1',
      isDeployed: true,
      state: { blocks: {}, edges: [], loops: {}, parallels: {} },
    }
    mockRequestJson.mockResolvedValue({ data: envelope })

    const result = await fetchWorkflowEnvelope('wf-1')

    expect(result).toBe(envelope)
  })

  it('forwards params.id and signal to requestJson against the contract', async () => {
    mockRequestJson.mockResolvedValue({ data: { id: 'wf-2' } })
    const controller = new AbortController()

    await fetchWorkflowEnvelope('wf-2', controller.signal)

    expect(mockRequestJson).toHaveBeenCalledTimes(1)
    expect(mockRequestJson).toHaveBeenCalledWith(
      { __contract: 'getWorkflowState' },
      { params: { id: 'wf-2' }, signal: controller.signal }
    )
  })
})
