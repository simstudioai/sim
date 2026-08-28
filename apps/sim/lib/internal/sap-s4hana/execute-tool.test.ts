/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const { mockExecuteOperation } = vi.hoisted(() => ({
  mockExecuteOperation: vi.fn(),
}))

vi.mock('@/lib/internal/sap-s4hana/operations', () => {
  class SapS4HanaProviderError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message)
    }
  }
  return {
    executeSapS4HanaOperation: mockExecuteOperation,
    SapS4HanaProviderError,
  }
})

import { executeSapS4HanaTool, SAP_S4HANA_TOOL_IDS } from '@/lib/internal/sap-s4hana/execute-tool'
import { SapS4HanaProviderError } from '@/lib/internal/sap-s4hana/operations'

const VALID_INPUT = {
  subdomain: 'example',
  region: 'us30',
  clientId: 'client',
  clientSecret: 'secret',
  service: 'API_BUSINESS_PARTNER',
  path: '/A_BusinessPartner',
  method: 'GET',
}

function createCall(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'sap_s4hana_list_business_partners',
    input: VALID_INPUT,
    headers: new Headers(),
    context: { userId: 'user-1', workspaceId: 'workspace-1' },
    requestId: 'request-1',
    signal: new AbortController().signal,
    ...overrides,
  }
}

describe('executeSapS4HanaTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteOperation.mockResolvedValue({ status: 200, data: [] })
  })

  it('dispatches every canonical SAP S/4HANA tool ID', async () => {
    for (const toolId of SAP_S4HANA_TOOL_IDS) {
      const response = await executeSapS4HanaTool(createCall({ toolId }))
      expect(response.status).toBe(200)
    }
    expect(mockExecuteOperation).toHaveBeenCalledTimes(SAP_S4HANA_TOOL_IDS.length)
  })

  it('preserves the first validation error in the 400 envelope', async () => {
    const response = await executeSapS4HanaTool(createCall({ input: {} }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Invalid input: expected string, received undefined',
    })
    expect(mockExecuteOperation).not.toHaveBeenCalled()
  })

  it('preserves provider status and error envelopes', async () => {
    mockExecuteOperation.mockRejectedValue(new SapS4HanaProviderError('Not found', 404))
    const response = await executeSapS4HanaTool(createCall())
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Not found',
      status: 404,
    })
  })

  it('honors cancellation before dispatch', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      executeSapS4HanaTool(createCall({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockExecuteOperation).not.toHaveBeenCalled()
  })
})
