/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operations = vi.hoisted(() => ({
  createUptimeRobotPsp: vi.fn(),
  updateUptimeRobotPsp: vi.fn(),
}))

vi.mock('@/lib/internal/uptimerobot/operations', () => operations)

import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { UptimeRobotOperationError } from '@/lib/internal/uptimerobot/errors'
import { executeUptimeRobotTool } from '@/lib/internal/uptimerobot/execute-tool'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'uptimerobot_create_psp',
    input: { apiKey: 'key', friendlyName: 'Status' },
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeUptimeRobotTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    operations.createUptimeRobotPsp.mockResolvedValue({
      success: true,
      output: { psp: { id: 1, friendlyName: 'Status' } },
    })
    operations.updateUptimeRobotPsp.mockResolvedValue({
      success: true,
      output: { psp: { id: 1, friendlyName: 'Updated' } },
    })
  })

  it('dispatches create with trusted identity and cancellation', async () => {
    const controller = new AbortController()
    const input = { apiKey: 'key', friendlyName: 'Status' }

    const response = await executeUptimeRobotTool(request({ input, signal: controller.signal }))

    expect(response.status).toBe(200)
    expect(operations.createUptimeRobotPsp).toHaveBeenCalledWith(input, {
      userId: 'user-1',
      requestId: 'request-1',
      signal: controller.signal,
    })
  })

  it('dispatches update without HTTP-shaped request metadata', async () => {
    const input = { apiKey: 'key', pspId: 1, friendlyName: 'Updated' }

    const response = await executeUptimeRobotTool(
      request({ toolId: 'uptimerobot_update_psp', input })
    )

    expect(response.status).toBe(200)
    expect(operations.updateUptimeRobotPsp).toHaveBeenCalledWith(input, {
      userId: 'user-1',
      requestId: 'request-1',
      signal: undefined,
    })
  })

  it('authenticates before validating input', async () => {
    const response = await executeUptimeRobotTool(
      request({
        input: null,
        context: createExecutionContext({ workflowId: 'workflow-1' }),
      })
    )

    expect(response.status).toBe(401)
    expect(operations.createUptimeRobotPsp).not.toHaveBeenCalled()
  })

  it('preserves operation error status and message', async () => {
    operations.createUptimeRobotPsp.mockRejectedValue(
      new UptimeRobotOperationError('provider limited', 429)
    )

    const response = await executeUptimeRobotTool(request())

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'provider limited' })
  })

  it('propagates cancellation before provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeUptimeRobotTool(request({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operations.createUptimeRobotPsp).not.toHaveBeenCalled()
  })
})
