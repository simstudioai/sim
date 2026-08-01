/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as requestModule from '@/lib/api/client/request'
import { getWorkflowStateContract } from '@/lib/api/contracts/workflows'
import { fetchWorkflowEnvelope } from '@/hooks/queries/utils/fetch-workflow-envelope'

/**
 * Spy on the real module namespace instead of vi.mock: under `isolate: false`
 * `@/hooks/queries/utils/fetch-workflow-envelope` may already be cached bound
 * to the real request module, so patching the shared namespace is the only
 * wiring that always applies.
 */
const mockRequestJson = vi.spyOn(requestModule, 'requestJson')

afterAll(() => {
  mockRequestJson.mockRestore()
})

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
    expect(mockRequestJson).toHaveBeenCalledWith(getWorkflowStateContract, {
      params: { id: 'wf-2' },
      signal: controller.signal,
    })
  })
})
