/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => ({
  executeCrowdStrikeRequest: vi.fn(),
}))

vi.mock('@/lib/internal/crowdstrike/operations', () => operationMocks)

import { CrowdStrikeAuthError } from '@/lib/internal/crowdstrike/client'
import { executeCrowdStrikeTool } from '@/lib/internal/crowdstrike/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CROWDSTRIKE_TOOL_IDS = [
  'crowdstrike_create_indicators',
  'crowdstrike_delete_indicators',
  'crowdstrike_delete_rtr_session',
  'crowdstrike_execute_rtr_command',
  'crowdstrike_get_alert_details',
  'crowdstrike_get_case_details',
  'crowdstrike_get_host_group_details',
  'crowdstrike_get_indicator_details',
  'crowdstrike_get_rtr_command_status',
  'crowdstrike_get_sensor_aggregates',
  'crowdstrike_get_sensor_details',
  'crowdstrike_get_vulnerability_details',
  'crowdstrike_init_rtr_session',
  'crowdstrike_perform_host_action',
  'crowdstrike_perform_host_group_action',
  'crowdstrike_query_alerts',
  'crowdstrike_query_cases',
  'crowdstrike_query_host_groups',
  'crowdstrike_query_indicators',
  'crowdstrike_query_sensors',
  'crowdstrike_query_vulnerabilities',
  'crowdstrike_update_alerts',
  'crowdstrike_update_indicators',
] as const

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'crowdstrike_query_sensors',
    input: {
      operation: 'crowdstrike_query_sensors',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      cloud: 'us-1',
      limit: 25,
    },
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeCrowdStrikeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    operationMocks.executeCrowdStrikeRequest.mockResolvedValue({
      ok: true,
      output: { sensors: [], count: 0, errors: [], pagination: null },
    })
  })

  it('validates the canonical contract and dispatches with cancellation', async () => {
    const controller = new AbortController()
    const response = await executeCrowdStrikeTool(createRequest({ signal: controller.signal }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      output: { sensors: [], count: 0, errors: [], pagination: null },
    })
    expect(operationMocks.executeCrowdStrikeRequest).toHaveBeenCalledWith(
      {
        operation: 'crowdstrike_query_sensors',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        cloud: 'us-1',
        limit: 25,
      },
      controller.signal
    )
  })

  it.each(CROWDSTRIKE_TOOL_IDS)('recognizes canonical tool ID %s', async (toolId) => {
    const response = await executeCrowdStrikeTool(createRequest({ toolId }))

    expect(response.status).toBe(200)
  })

  it('preserves canonical validation details', async () => {
    const response = await executeCrowdStrikeTool(
      createRequest({ input: { operation: 'crowdstrike_query_sensors' } })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Invalid input: expected string, received undefined',
      details: expect.any(Array),
    })
    expect(operationMocks.executeCrowdStrikeRequest).not.toHaveBeenCalled()
  })

  it('preserves Falcon operation and authentication statuses', async () => {
    operationMocks.executeCrowdStrikeRequest.mockResolvedValueOnce({
      ok: false,
      status: 429,
      error: 'rate limited',
    })
    const providerResponse = await executeCrowdStrikeTool(createRequest())
    expect(providerResponse.status).toBe(429)
    await expect(providerResponse.json()).resolves.toEqual({
      success: false,
      error: 'rate limited',
    })

    operationMocks.executeCrowdStrikeRequest.mockRejectedValueOnce(
      new CrowdStrikeAuthError('invalid credentials', 401)
    )
    const authResponse = await executeCrowdStrikeTool(createRequest())
    expect(authResponse.status).toBe(401)
    await expect(authResponse.json()).resolves.toEqual({
      success: false,
      error: 'invalid credentials',
    })
  })

  it('preserves the route-compatible generic provider failure envelope', async () => {
    operationMocks.executeCrowdStrikeRequest.mockRejectedValueOnce(new Error('network unavailable'))

    const response = await executeCrowdStrikeTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'network unavailable',
    })
  })

  it('propagates cancellation instead of converting it into a provider error', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeCrowdStrikeTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeCrowdStrikeRequest).not.toHaveBeenCalled()
  })
})
