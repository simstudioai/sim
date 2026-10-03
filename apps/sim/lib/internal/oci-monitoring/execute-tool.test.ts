/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  createClient: vi.fn(),
  execute: vi.fn(),
}))
vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUseForAuth: mocks.authorize,
}))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.createClient }))
vi.mock('@/lib/internal/oci-monitoring/operations', () => ({
  executeOciMonitoringOperation: mocks.execute,
  OciMonitoringInputError: class OciMonitoringInputError extends Error {},
}))

import { OciClientError } from '@/lib/internal/oci/errors'
import { executeOciMonitoringTool } from '@/lib/internal/oci-monitoring/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const connection = { oauthCredential: 'requested-credential', region: 'us-ashburn-1' }
const alarm = {
  compartmentId: 'compartment',
  metricCompartmentId: 'metrics-compartment',
  displayName: 'CPU',
  namespace: 'oci_computeagent',
  query: 'CpuUtilization[1m].mean() > 80',
  severity: 'WARNING',
  destinations: ['topic'],
  isEnabled: false,
}
const metric = {
  compartmentId: 'compartment',
  namespace: 'my_app',
  name: 'Requests',
  dimensions: { resourceId: 'instance' },
  datapoints: [{ timestamp: '2026-09-05T12:00:00Z', value: 0 }],
}
const cases = [
  ['list_metrics', { compartmentId: 'compartment' }],
  [
    'summarize_metrics_data',
    {
      compartmentId: 'compartment',
      namespace: 'my_app',
      query: 'Requests[1m].mean()',
    },
  ],
  ['post_metric_data', { metricData: [metric] }],
  ['list_alarms', { compartmentId: 'compartment' }],
  ['list_alarms_status', { compartmentId: 'compartment' }],
  ['get_alarm', { alarmId: 'alarm' }],
  ['get_alarm_history', { alarmId: 'alarm' }],
  ['retrieve_dimension_states', { alarmId: 'alarm' }],
  ['create_alarm', alarm],
  ['update_alarm', { alarmId: 'alarm', isEnabled: false }],
  ['delete_alarm', { alarmId: 'alarm' }],
  [
    'create_alarm_suppression',
    {
      alarmId: 'alarm',
      displayName: 'Maintenance',
      timeSuppressFrom: '2026-09-05T12:00:00Z',
      timeSuppressUntil: '2026-09-05T13:00:00Z',
    },
  ],
  ['list_alarm_suppressions', { alarmId: 'alarm' }],
  ['get_alarm_suppression', { alarmSuppressionId: 'suppression' }],
  ['delete_alarm_suppression', { alarmSuppressionId: 'suppression' }],
  ['summarize_alarm_suppression_history', { alarmId: 'alarm' }],
  ['remove_alarm_suppression', { alarmId: 'alarm' }],
] as const
const client = { bound: true }

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'oci_monitoring_list_metrics',
    input: { ...connection, compartmentId: 'compartment' },
    headers: new Headers(),
    context: {
      userId: 'trusted-user',
      workspaceId: 'trusted-workspace',
      workflowId: 'trusted-workflow',
    },
    requestId: 'request',
    ...overrides,
  }
}

describe('OCI Monitoring internal dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({
      ok: true,
      resolvedCredentialId: 'authorized-credential',
      credentialType: 'service_account',
    })
    mocks.createClient.mockResolvedValue(client)
    mocks.execute.mockResolvedValue({ success: true, output: { opcRequestId: 'oracle-request' } })
  })

  it.each(cases)('authorizes and dispatches %s with cancellation', async (operation, input) => {
    const controller = new AbortController()
    const response = await executeOciMonitoringTool(
      request({
        toolId: `oci_monitoring_${operation}`,
        input: { ...connection, ...input },
        signal: controller.signal,
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith(
      client,
      operation,
      expect.objectContaining(input),
      controller.signal
    )
    expect(mocks.createClient).toHaveBeenCalledWith({
      credentialId: 'authorized-credential',
      workspaceId: 'trusted-workspace',
      serviceId: 'oci_monitoring',
      region: 'us-ashburn-1',
    })
  })

  it('uses execution identity and scope instead of forged input context', async () => {
    await executeOciMonitoringTool(
      request({
        input: {
          ...connection,
          compartmentId: 'compartment',
          userId: 'forged-user',
          workspaceId: 'forged-workspace',
          workflowId: 'forged-workflow',
          resolvedCredentialId: 'forged-credential',
          serviceId: 'oci_logging',
        },
      })
    )

    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, userId: 'trusted-user' }),
      {
        credentialId: 'requested-credential',
        workspaceId: 'trusted-workspace',
        workflowId: 'trusted-workflow',
        callerUserId: 'trusted-user',
      }
    )
    expect(mocks.execute.mock.calls[0][2]).not.toHaveProperty('workspaceId')
  })

  it.each(['userId', 'workspaceId'] as const)(
    'rejects a missing trusted %s even when supplied in input',
    async (field) => {
      const call = request()
      call.context[field] = undefined
      call.input = { ...connection, compartmentId: 'compartment', [field]: 'forged' }

      expect((await executeOciMonitoringTool(call)).status).toBe(403)
      expect(mocks.authorize).not.toHaveBeenCalled()
      expect(mocks.createClient).not.toHaveBeenCalled()
    }
  )

  it.each([
    { ok: false },
    { ok: true, credentialType: 'oauth', resolvedCredentialId: 'wrong-kind' },
    { ok: true, credentialType: 'service_account' },
  ])('rejects unauthorized credentials before client creation: %j', async (access) => {
    mocks.authorize.mockResolvedValueOnce(access)
    expect((await executeOciMonitoringTool(request())).status).toBe(403)
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects invalid input before credential or provider work', async () => {
    const response = await executeOciMonitoringTool(request({ input: connection }))
    expect(response.status).toBe(400)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it.each(['oci_monitoring_unknown', 'oci_monitoring_toString', 'wrong_list_metrics'])(
    'rejects an unregistered operation %s',
    async (toolId) => {
      expect((await executeOciMonitoringTool(request({ toolId }))).status).toBe(400)
      expect(mocks.authorize).not.toHaveBeenCalled()
    }
  )

  it('preserves partial ingestion details and non-retryability', async () => {
    const failure = {
      success: false,
      retryable: false,
      error: 'Rejected metric',
      output: {
        failedMetricsCount: 1,
        failedMetrics: [{ message: 'invalid', metricData: metric }],
      },
    }
    mocks.execute.mockResolvedValueOnce(failure)
    const response = await executeOciMonitoringTool(
      request({
        toolId: 'oci_monitoring_post_metric_data',
        input: { ...connection, metricData: [metric] },
      })
    )
    await expect(response.json()).resolves.toEqual(failure)
  })

  it('marks ingestion transport failures non-retryable and retains the request ID', async () => {
    mocks.execute.mockRejectedValueOnce(
      new OciClientError('request_failed', { status: 503, opcRequestId: 'failed-request' })
    )
    const response = await executeOciMonitoringTool(
      request({
        toolId: 'oci_monitoring_post_metric_data',
        input: { ...connection, metricData: [metric] },
      })
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      retryable: false,
      output: { opcRequestId: 'failed-request' },
    })
  })

  it('maps foundation credential failures to authorization failures', async () => {
    mocks.createClient.mockRejectedValueOnce(new OciClientError('credential_unavailable'))
    expect((await executeOciMonitoringTool(request())).status).toBe(403)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('classifies the response byte limit as a deterministic failure with narrowing guidance', async () => {
    mocks.execute.mockRejectedValueOnce(new OciClientError('response_too_large'))
    const response = await executeOciMonitoringTool(request())
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      retryable: false,
      error: expect.stringContaining('8 MiB response budget; narrow'),
    })
  })

  it('does not expose unexpected errors or credential material', async () => {
    mocks.createClient.mockRejectedValueOnce(new Error('private-key-canary'))
    const response = await executeOciMonitoringTool(request())
    expect(await response.text()).not.toContain('private-key-canary')
  })

  it('preserves cancellation during authorization', async () => {
    const controller = new AbortController()
    mocks.authorize.mockImplementationOnce(async () => {
      controller.abort()
      return { ok: true, credentialType: 'service_account', resolvedCredentialId: 'credential' }
    })
    await expect(
      executeOciMonitoringTool(
        request({
          signal: controller.signal,
        })
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
})
