/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.createClient }))
vi.mock('@/lib/internal/oci-monitoring/operations', () => ({
  executeOciMonitoringOperation: mocks.execute,
}))
vi.mock('@/blocks/registry', () => ({ getBlock: vi.fn() }))

import { OciClientError } from '@/lib/internal/oci/errors'
import { ociMonitoringInputSchemas } from '@/lib/internal/oci-monitoring/input'
import {
  buildSelectorContextFromValues,
  getSelectorContextSubBlocks,
} from '@/lib/selectors/context'
import { isSelectorReady } from '@/lib/selectors/manifest'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { ociMonitoringSelectorAttachments } from '@/lib/selectors/server/providers/oci-monitoring'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'
import { parseDependsOn } from '@/lib/workflows/subblocks/visibility'
import { OciMonitoringBlock } from '@/blocks/blocks/oci_monitoring'

const client = { bound: true }
const selectors = ociMonitoringSelectorAttachments

function args(
  selectorKey: ExecuteServerSelectorArgs['selectorKey'] = 'oci_monitoring.namespaces'
): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context: {
      oauthCredential: 'requested-credential',
      region: 'us-ashburn-1',
      compartmentId: 'compartment',
      alarmId: 'alarm',
    },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace' },
    workspaceId: 'workspace',
    principal: { kind: 'session', userId: 'user', sessionId: 'session' },
    requesterUserId: 'user',
    credential: {
      suppliedId: 'requested-credential',
      access: {
        ok: true,
        resolvedCredentialId: 'authorized-credential',
        credentialType: 'service_account',
      },
    },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

describe('OCI Monitoring selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClient.mockResolvedValue(client)
  })

  it('clears untouched fields after the shared handler merges block parameters', () => {
    const raw = {
      operation: 'summarize_metrics_data',
      oauthCredential: 'credential',
      compartmentId: 'compartment',
      namespace: 'my_app',
      query: 'Requests[5m].mean()',
      region: null,
      resourceGroup: null,
      startTime: '',
      endTime: null,
      resolution: '',
      maxStreams: '20',
      maxDatapoints: '',
      compartmentIdInSubtree: 'false',
    }
    const merged = { ...raw, ...OciMonitoringBlock.tools.config!.params!(raw) }
    expect(ociMonitoringInputSchemas.summarize_metrics_data.parse(merged)).toMatchObject({
      region: undefined,
      resourceGroup: undefined,
      startTime: undefined,
      endTime: undefined,
      maxStreams: 20,
      maxDatapoints: 10000,
      compartmentIdInSubtree: false,
      query: raw.query,
    })
  })

  it('keeps explicit false, zero and empty collections during block normalization', () => {
    const raw = {
      operation: 'update_alarm',
      oauthCredential: 'credential',
      alarmId: 'alarm',
      isEnabled: 'false',
      freeformTags: {},
      overrides: [],
      limit: 0,
      displayName: null,
    }
    const merged = { ...raw, ...OciMonitoringBlock.tools.config!.params!(raw) }
    expect(merged).toMatchObject({
      isEnabled: false,
      freeformTags: {},
      overrides: [],
      limit: 0,
      displayName: undefined,
    })
    expect(ociMonitoringInputSchemas.update_alarm.parse(merged)).toMatchObject({
      isEnabled: false,
      freeformTags: {},
      overrides: [],
      displayName: undefined,
    })
  })

  it.each([
    ['oci_monitoring.namespaces', 'list_metrics', { compartmentId: 'compartment' }],
    ['oci_monitoring.namespaces', 'create_alarm', { metricCompartmentId: 'metrics-compartment' }],
    ['oci_monitoring.alarms', 'get_alarm', { compartmentId: 'compartment' }],
    ['oci_monitoring.alarmSuppressions', 'get_alarm_suppression', { alarmIdSelector: 'alarm' }],
  ] as const)('permits credential-region defaults for %s during %s', (key, operation, scope) => {
    const values = { credential: 'credential', operation, ...scope }
    const selector = OciMonitoringBlock.subBlocks.find((config) => config.selectorKey === key)!
    const dependencies = parseDependsOn(selector.dependsOn)
    const context = buildSelectorContextFromValues({
      selectorKey: key,
      contextConfigs: getSelectorContextSubBlocks(OciMonitoringBlock.subBlocks, values, false),
      values,
      dependsOn: dependencies.allDependsOnFields,
    })

    const contextValues: Record<string, unknown> = context
    expect(dependencies.allFields.every((field) => Boolean(contextValues[field]))).toBe(true)
    expect(dependencies.anyFields.some((field) => Boolean(contextValues[field]))).toBe(true)
    expect(isSelectorReady(key, context)).toBe(true)
    expect(context.region).toBeUndefined()
  })

  it('uses the credential region when an override is omitted', async () => {
    mocks.execute.mockResolvedValue({ success: true, output: { metrics: [] } })
    const call = args()
    call.context.region = undefined
    await selectors['oci_monitoring.namespaces'].execute(call)
    expect(mocks.createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: 'authorized-credential',
        region: undefined,
      })
    )
  })

  it('uses the shared authorization result and groups metric discovery by namespace', async () => {
    mocks.execute.mockResolvedValue({
      success: true,
      output: { metrics: [{ namespace: 'oci_computeagent' }, { namespace: 'oci_computeagent' }] },
    })
    const call = args()
    call.context.metricCompartmentId = 'metrics-compartment'

    await expect(selectors['oci_monitoring.namespaces'].execute(call)).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'oci_computeagent', label: 'oci_computeagent' }],
    })
    expect(mocks.createClient).toHaveBeenCalledWith({
      credentialId: 'authorized-credential',
      workspaceId: 'workspace',
      serviceId: 'oci_monitoring',
      region: 'us-ashburn-1',
    })
    expect(mocks.execute).toHaveBeenCalledWith(
      client,
      'list_metrics',
      expect.objectContaining({
        compartmentId: 'metrics-compartment',
        groupBy: ['namespace'],
        limit: 100,
      }),
      undefined
    )
  })

  it.each([
    ['oci_monitoring.namespaces', 'metrics'],
    ['oci_monitoring.alarms', 'alarms'],
    ['oci_monitoring.alarmSuppressions', 'alarmSuppressions'],
  ] as const)('preserves empty-page cursors for %s', async (key, field) => {
    mocks.execute.mockResolvedValue({
      success: true,
      output: { [field]: [], nextPage: 'next::+=/' },
    })
    const call = args(key)
    call.request = { kind: 'list', cursor: 'previous::+=/' }

    await expect(selectors[key].execute(call, client)).resolves.toEqual({
      kind: 'list',
      items: [],
      nextCursor: 'next::+=/',
    })
    expect(mocks.execute).toHaveBeenCalledWith(
      client,
      expect.any(String),
      expect.objectContaining({ page: 'previous::+=/' }),
      undefined
    )
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['oci_monitoring.alarms', 'alarms', 'list_alarms', { compartmentId: 'compartment' }],
    [
      'oci_monitoring.alarmSuppressions',
      'alarmSuppressions',
      'list_alarm_suppressions',
      { alarmId: 'alarm' },
    ],
  ] as const)(
    'projects safe options and exact-name search for %s',
    async (key, field, operation, scope) => {
      mocks.execute.mockResolvedValue({
        success: true,
        output: { [field]: [{ id: 'selected', displayName: 'CPU', body: 'private' }] },
      })
      const call = args(key)
      call.request = { kind: 'list', search: 'CPU' }

      await expect(selectors[key].execute(call, client)).resolves.toEqual({
        kind: 'list',
        items: [{ id: 'selected', label: 'CPU' }],
      })
      expect(mocks.execute).toHaveBeenCalledWith(
        client,
        operation,
        expect.objectContaining({ ...scope, displayName: 'CPU' }),
        undefined
      )
    }
  )

  it('returns null when a namespace no longer exists', async () => {
    mocks.execute.mockResolvedValue({ success: true, output: { metrics: [] } })
    const call = args()
    call.request = { kind: 'detail', id: 'missing' }
    await expect(selectors['oci_monitoring.namespaces'].execute(call, client)).resolves.toEqual({
      kind: 'detail',
      item: null,
    })
    expect(mocks.execute.mock.calls[0][2]).toMatchObject({
      namespace: 'missing',
      groupBy: ['namespace'],
    })
  })

  it.each(['oci_monitoring.alarms', 'oci_monitoring.alarmSuppressions'] as const)(
    'returns null for deleted selections in %s',
    async (key) => {
      mocks.execute.mockRejectedValueOnce(new OciClientError('request_failed', { status: 404 }))
      const call = args(key)
      call.request = { kind: 'detail', id: 'missing' }
      await expect(selectors[key].execute(call, client)).resolves.toEqual({
        kind: 'detail',
        item: null,
      })
    }
  )

  it('does not retain an alarm selection from another compartment', async () => {
    mocks.execute.mockResolvedValue({
      success: true,
      output: { alarm: { id: 'old', displayName: 'Old', compartmentId: 'other' } },
    })
    const call = args('oci_monitoring.alarms')
    call.request = { kind: 'detail', id: 'old' }
    await expect(selectors['oci_monitoring.alarms'].execute(call, client)).resolves.toEqual({
      kind: 'detail',
      item: null,
    })
  })

  it('does not retain a suppression selection from another alarm', async () => {
    mocks.execute.mockResolvedValue({
      success: true,
      output: {
        alarmSuppression: {
          id: 'old',
          displayName: 'Old',
          alarmSuppressionTarget: { targetType: 'ALARM', alarmId: 'other' },
        },
      },
    })
    const call = args('oci_monitoring.alarmSuppressions')
    call.request = { kind: 'detail', id: 'old' }
    await expect(
      selectors['oci_monitoring.alarmSuppressions'].execute(call, client)
    ).resolves.toEqual({
      kind: 'detail',
      item: null,
    })
  })

  it('projects a matching alarm selection', async () => {
    mocks.execute.mockResolvedValue({
      success: true,
      output: { alarm: { id: 'alarm', displayName: 'CPU', compartmentId: 'compartment' } },
    })
    const call = args('oci_monitoring.alarms')
    call.request = { kind: 'detail', id: 'alarm' }
    await expect(selectors['oci_monitoring.alarms'].execute(call, client)).resolves.toEqual({
      kind: 'detail',
      item: { id: 'alarm', label: 'CPU' },
    })
  })

  it('requires prepared credential authorization', async () => {
    const call = args()
    call.credential = undefined
    await expect(selectors['oci_monitoring.namespaces'].execute(call)).rejects.toMatchObject({
      name: 'SelectorConnectionUnavailableError',
    })
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects incomplete context without calling a provider operation', async () => {
    const call = args()
    call.context = { oauthCredential: 'credential' }
    await expect(
      selectors['oci_monitoring.namespaces'].execute(call, client)
    ).rejects.toMatchObject({
      name: 'SelectorContextUnavailableError',
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'SelectorConnectionUnavailableError', 401],
    [403, 'SelectorConnectionUnavailableError', 403],
    [429, 'SelectorOptionsUnavailableError', 429],
    [500, 'SelectorOptionsUnavailableError', 502],
  ] as const)('maps trusted status %i to a safe error', async (status, name, safeStatus) => {
    mocks.execute.mockRejectedValueOnce(new OciClientError('request_failed', { status }))
    await expect(
      selectors['oci_monitoring.namespaces'].execute(args(), client)
    ).rejects.toMatchObject({
      name,
      status: safeStatus,
    })
  })

  it('does not trust status-shaped errors or expose provider data', async () => {
    mocks.execute.mockRejectedValueOnce({ status: 401, message: 'provider-secret-canary' })
    await expect(
      selectors['oci_monitoring.namespaces'].execute(args(), client)
    ).rejects.toMatchObject({
      name: 'SelectorOptionsUnavailableError',
      status: 502,
    })
  })

  it('preserves cancellation during a listing', async () => {
    const controller = new AbortController()
    const call = args()
    call.signal = controller.signal
    mocks.execute.mockImplementationOnce(async () => {
      controller.abort()
      throw new Error('interrupted')
    })
    await expect(
      selectors['oci_monitoring.namespaces'].execute(call, client)
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(mocks.execute.mock.calls[0][3]).toBe(controller.signal)
  })
})
