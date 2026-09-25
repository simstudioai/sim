import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GetWorkspaceOperationResponse } from '../../generated/v2-api'
import { SimApiError, SimClient } from '../../http/client'
import { assertWorkspaceOperationOutcome, waitWorkspaceOperation } from './workspace-operation-wait'

const report: GetWorkspaceOperationResponse['data'] = {
  operationId: 'operation-1',
  requestId: 'stable-request',
  workspaceId: 'ws-1',
  kind: 'workspace_push',
  applied: true,
  status: 'processing',
  resourceIds: ['workflow-1'],
  issues: [],
}

function fixtureClient() {
  return new SimClient({
    name: 'fixture',
    endpoint: 'https://fixture.invalid',
    authProfile: 'fixture',
    apiKey: 'fixture-key',
    oauth: null,
    workspaceId: 'ws-1',
    output: 'json',
    sources: { endpoint: 'default', credential: 'env', workspaceId: 'env', output: 'default' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('workspace operation waiting', () => {
  it('retains the operation ID and timeout exit code even before the first response', async () => {
    vi.useFakeTimers()
    const client = fixtureClient()
    vi.spyOn(client, 'request').mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 2000)
      throw new SimApiError('Request cancelled', 0)
    })
    await expect(waitWorkspaceOperation(client, 'ws-1', 'operation-1', 1)).rejects.toMatchObject({
      exitCode: 4,
      code: 'OPERATION_WAIT_TIMEOUT',
      details: { operationId: 'operation-1', workspaceId: 'ws-1' },
    })
  })

  it('retains a committed receipt when waiting times out', async () => {
    vi.useFakeTimers()
    const client = fixtureClient()
    vi.spyOn(client, 'request').mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 2000)
      throw new SimApiError('Request cancelled', 0)
    })
    const result = await waitWorkspaceOperation(client, 'ws-1', 'operation-1', 1, report)
    expect(result).toEqual({ report, timedOut: true })
    expect(() => assertWorkspaceOperationOutcome(result.report, result.timedOut)).toThrow(
      expect.objectContaining({
        exitCode: 4,
        details: expect.objectContaining({ requestId: report.requestId, applied: true }),
      })
    )
  })

  it('rejects mismatched identities even in an initially complete receipt', async () => {
    await expect(
      waitWorkspaceOperation(fixtureClient(), 'other-workspace', 'operation-1', 1, {
        ...report,
        status: 'completed',
      })
    ).rejects.toMatchObject({
      code: 'INVALID_OPERATION_RECEIPT',
      details: { workspaceId: 'other-workspace', operationId: 'operation-1' },
    })
  })

  it.each([
    null,
    { data: { ...report, requestId: 'unrelated-request', operationId: 'unrelated-operation' } },
  ])('keeps the last trusted receipt when polling returns invalid data', async (response) => {
    const client = fixtureClient()
    vi.spyOn(client, 'request').mockResolvedValue(response)
    await expect(
      waitWorkspaceOperation(client, 'ws-1', 'operation-1', 1, report)
    ).rejects.toMatchObject({
      name: 'SimApiError',
      details: {
        workspaceId: 'ws-1',
        operationId: 'operation-1',
        requestId: 'stable-request',
        applied: true,
      },
    })
  })
})
