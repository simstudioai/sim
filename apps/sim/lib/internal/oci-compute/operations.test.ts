/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { OciClient, OciRequest } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  executeOciComputeOperation,
  resolveOciComputeRetryToken,
} from '@/lib/internal/oci-compute/operations'
import { type OciComputeOperation, ociComputeSchemas } from '@/lib/internal/oci-compute/schema'

const auth = { oauthCredential: 'credential', region: 'us-ashburn-1' }
function harness(data: unknown = {}, status = 200, headers: Record<string, string> = {}) {
  const request = vi.fn().mockResolvedValue({
    status,
    headers: { 'opc-request-id': 'request', ...headers },
    body: new TextEncoder().encode(status === 204 ? '' : JSON.stringify(data)),
  })
  const client = {
    prepareStaticEndpoint: vi.fn().mockResolvedValue({}),
    request,
  } as unknown as OciClient
  return { client, request }
}
async function run(operation: OciComputeOperation, input: Record<string, unknown>, h = harness()) {
  const result = await executeOciComputeOperation(
    h.client,
    operation,
    ociComputeSchemas[operation].parse({ ...auth, ...input })
  )
  return { ...h, result }
}
function body(request: OciRequest) {
  return request.body?.length ? JSON.parse(new TextDecoder().decode(request.body)) : undefined
}

describe('OCI Compute requests', () => {
  it('preserves token and payload across re-entry of a lifecycle invocation', async () => {
    const input = {
      instanceId: 'instance', action: 'STOP',
      deliveryIdentity: { executionId: 'execution', blockId: 'block', invocationId: 'call' },
    }
    const first = await run('instance_action', input)
    const second = await run('instance_action', input)
    expect(first.request.mock.calls[0][0].retry).toEqual(second.request.mock.calls[0][0].retry)
    expect(body(first.request.mock.calls[0][0])).toEqual(body(second.request.mock.calls[0][0]))
  })

  it('builds configuration creation and deferred launch overrides distinctly', async () => {
    const created = await run('create_instance_configuration', {
      compartmentId: 'destination', configurationSource: 'INSTANCE', instanceId: 'source',
    })
    expect(body(created.request.mock.calls[0][0])).toEqual({
      compartmentId: 'destination', source: 'INSTANCE', instanceId: 'source',
    })
    const launched = await run('launch_instance_configuration', {
      instanceConfigurationId: 'configuration',
      instanceDetails: { instanceType: 'compute', blockVolumes: [{ volumeId: 'existing' }] },
    })
    expect(body(launched.request.mock.calls[0][0])).toEqual({
      instanceType: 'compute', blockVolumes: [{ volumeId: 'existing' }],
    })
  })

  it('returns optional work headers and sends explicit member-detachment choices', async () => {
    const { request, result } = await run('detach_instance_pool_instance', {
      instancePoolId: 'pool', instanceId: 'instance', isAutoTerminate: false, isDecrementSize: false,
      retryToken: 'member-delivery',
    }, harness(undefined, 202, { 'opc-work-request-id': 'work' }))
    expect(body(request.mock.calls[0][0])).toEqual({
      instanceId: 'instance', isAutoTerminate: false, isDecrementSize: false,
    })
    expect(result.output).toMatchObject({ workRequestId: 'work', retryToken: 'member-delivery' })
  })

  it.each([
    ['image', { imageId: 'image' }, { sourceType: 'image', imageId: 'image' }],
    [
      'imageFilter',
      { imageFilter: { compartmentId: 'images' } },
      {
        sourceType: 'image',
        instanceSourceImageFilterDetails: { compartmentId: 'images' },
      },
    ],
    ['bootVolume', { bootVolumeId: 'boot' }, { sourceType: 'bootVolume', bootVolumeId: 'boot' }],
  ])('builds the %s launch source and retains its token', async (sourceMode, source, expected) => {
    const { request, result } = await run('launch_instance', {
      compartmentId: 'compartment',
      availabilityDomain: 'AD',
      shape: 'shape',
      createVnicDetails: { subnetId: 'subnet', assignPublicIp: false },
      sourceMode,
      ...source,
      retryToken: 'explicit-token',
    })
    expect(body(request.mock.calls[0][0])).toMatchObject({ sourceDetails: expected })
    expect(request.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      encodedPath: '/20160918/instances/',
      retry: { kind: 'tokenized', maxAttempts: 2, retryToken: 'explicit-token' },
      maxResponseBytes: 2_000_000,
    })
    expect(result.output).toMatchObject({ retryToken: 'explicit-token', workRequestId: null })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['START', {}, undefined],
    [
      'RESET',
      { allowDenseRebootMigration: false },
      { actionType: 'reset', allowDenseRebootMigration: false },
    ],
    [
      'SOFTRESET',
      { allowDenseRebootMigration: true },
      { actionType: 'softreset', allowDenseRebootMigration: true },
    ],
    [
      'REBOOTMIGRATE',
      { deleteLocalStorage: false },
      { actionType: 'rebootMigrate', deleteLocalStorage: false },
    ],
  ])('discriminates the %s lifecycle body', async (action, fields, expected) => {
    const { request } = await run('instance_action', {
      instanceId: 'instance',
      action,
      ...fields,
      ifMatch: 'etag',
    })
    expect(body(request.mock.calls[0][0])).toEqual(expected)
    expect(request.mock.calls[0][0]).toMatchObject({
      queryPairs: [['action', action]],
      headers: { 'if-match': 'etag' },
    })
    expect(request.mock.calls[0][0].retry).toMatchObject({ kind: 'tokenized', maxAttempts: 2 })
  })

  it('uses a pool action path and a single attempt', async () => {
    const { request } = await run('instance_pool_action', {
      instancePoolId: 'pool',
      action: 'SOFTSTOP',
    })
    expect(request.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      encodedPath: '/20160918/instancePools/pool/actions/softstop',
    })
    expect(body(request.mock.calls[0][0])).toBeUndefined()
    expect(request.mock.calls[0][0].retry).toMatchObject({ kind: 'tokenized', maxAttempts: 2 })
  })

  it('terminates once with explicit preservation choices and accepts an empty response', async () => {
    const { request, result } = await run(
      'terminate_instance',
      {
        instanceId: 'instance',
        preserveBootVolume: false,
        preserveDataVolumesCreatedAtLaunch: true,
        ifMatch: 'etag',
      },
      harness(undefined, 204)
    )
    expect(result.success).toBe(true)
    expect(request.mock.calls[0][0]).toMatchObject({
      method: 'DELETE',
      headers: { 'if-match': 'etag' },
      queryPairs: [
        ['preserveBootVolume', 'false'],
        ['preserveDataVolumesCreatedAtLaunch', 'true'],
      ],
    })
    expect(request.mock.calls[0][0].retry).toBeUndefined()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('retains pagination on an empty page and encodes opaque IDs once', async () => {
    const { request, result } = await run(
      'list_instance_pool_instances',
      {
        instancePoolId: 'pool/a',
        compartmentId: 'compartment',
        page: 'opaque+/=',
        limit: 50,
      },
      harness([], 200, { 'opc-next-page': 'next' })
    )
    expect(result.output).toMatchObject({ poolInstances: [], nextPage: 'next' })
    expect(request.mock.calls[0][0]).toMatchObject({
      encodedPath: '/20160918/instancePools/pool%2Fa/instances',
      retry: { kind: 'safe', maxAttempts: 2 },
    })
    expect(request.mock.calls[0][0].queryPairs).toContainEqual(['page', 'opaque+/='])
  })

  it('does not replay an ambiguous termination or expose provider body text', async () => {
    const h = harness()
    h.request.mockRejectedValue(new OciClientError('request_failed'))
    const { result } = await run('terminate_instance', { instanceId: 'instance' }, h)
    expect(result).toMatchObject({
      success: false,
      retryable: false,
      output: { outcome: 'unknown' },
    })
    expect(h.request).toHaveBeenCalledTimes(1)
  })

  it('retains correlation when a successful mutation response cannot be projected', async () => {
    const { result, request } = await run('create_image', {
      instanceId: 'instance', compartmentId: 'compartment', retryToken: 'token',
    }, harness({ id: { invalid: true } }))
    expect(result).toMatchObject({
      success: false, retryable: false,
      output: { outcome: 'unknown', status: 200, requestId: 'request', retryToken: 'token' },
    })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('requires immutable metadata to be retained and uses the pre-read ETag', async () => {
    const h = harness({ metadata: { user_data: 'encoded' }, extendedMetadata: {} }, 200, { etag: 'current' })
    const denied = await run('update_instance', { instanceId: 'instance', metadata: {} }, h)
    expect(denied.result.success).toBe(false)
    expect(h.request).toHaveBeenCalledTimes(1)
    h.request.mockClear()
    const accepted = await run('update_instance', {
      instanceId: 'instance', metadata: { user_data: 'encoded', purpose: 'test' },
    }, h)
    expect(accepted.result.success).toBe(true)
    expect(h.request.mock.calls[1][0]).toMatchObject({ headers: { 'if-match': 'current' } })
  })

  it('honors cancellation before dispatch', async () => {
    const h = harness()
    const controller = new AbortController()
    controller.abort()
    const result = await executeOciComputeOperation(h.client, 'get_instance',
      ociComputeSchemas.get_instance.parse({ ...auth, instanceId: 'instance' }), controller.signal)
    expect(result.success).toBe(false)
    expect(h.request).not.toHaveBeenCalled()
  })

  it('derives stable delivery tokens and distinguishes independent invocations', () => {
    const input = ociComputeSchemas.create_image.parse({
      ...auth, instanceId: 'instance', compartmentId: 'compartment',
      deliveryIdentity: { executionId: 'execution', blockId: 'block', invocationId: 'one' },
    })
    const token = resolveOciComputeRetryToken('create_image', input)
    expect(resolveOciComputeRetryToken('create_image', input)).toBe(token)
    expect(resolveOciComputeRetryToken('create_image', {
      ...input, deliveryIdentity: { ...input.deliveryIdentity!, invocationId: 'two' },
    })).not.toBe(token)
    expect(resolveOciComputeRetryToken('create_image', { ...input, retryToken: 'explicit' })).toBe('explicit')
    const { deliveryIdentity: _identity, ...unkeyed } = input
    expect(resolveOciComputeRetryToken('create_image', unkeyed)).not.toBe(resolveOciComputeRetryToken('create_image', unkeyed))
  })
})
