/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  request: vi.fn(),
  discover: vi.fn(),
  file: vi.fn(),
  authorizeFile: vi.fn(),
  download: vi.fn(),
}))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.create }))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processSingleFileToUserFile: mocks.file,
  isInternalFileUrl: () => true,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.download,
}))
vi.mock('@/app/api/files/authorization', () => ({ assertToolFileAccess: mocks.authorizeFile }))

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type { OciAuthenticatedResponse } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  OCI_FUNCTIONS_INVOCATION_POLICY,
  prepareOciFunctionsClient,
} from '@/lib/internal/oci-functions/client'
import {
  OCI_FUNCTIONS_PAYLOAD_LIMIT,
  ociFunctionsInputSchemas,
} from '@/lib/internal/oci-functions/input'
import {
  executeOciFunctionsChangeApplicationCompartment,
  executeOciFunctionsCreateApplication,
  executeOciFunctionsCreateFunction,
  executeOciFunctionsDeleteApplication,
  executeOciFunctionsDeleteFunction,
  executeOciFunctionsGetApplication,
  executeOciFunctionsGetFunction,
  executeOciFunctionsInvoke,
  executeOciFunctionsListApplications,
  executeOciFunctionsListFunctions,
  executeOciFunctionsUpdateApplication,
  executeOciFunctionsUpdateFunction,
  type OciFunctionsOperationContext,
} from '@/lib/internal/oci-functions/operations'

const auth = { oauthCredential: 'credential-1' }
const functionId = 'ocid1.fnfunc.oc1.test/a+b'
const applicationId = 'ocid1.fnapp.oc1.test'
const managementEndpoint = { origin: 'https://functions.us-ashburn-1.oci.oraclecloud.com' }
const invocationEndpoint = { origin: 'https://unique.us-ashburn-1.functions.oci.oraclecloud.com' }
function response(
  body: unknown = { id: functionId },
  status = 200,
  headers: Record<string, string> = {}
): OciAuthenticatedResponse {
  return {
    status,
    headers,
    opcRequestId: 'oracle-request',
    body: status === 204 ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body)),
  } as OciAuthenticatedResponse
}
async function context(signal?: AbortSignal): Promise<OciFunctionsOperationContext> {
  return {
    prepared: await prepareOciFunctionsClient({
      credentialId: 'credential-1',
      workspaceId: 'workspace-1',
    }),
    userId: 'user-1',
    requestId: 'request-1',
    signal,
  }
}
function invoke(overrides: Record<string, unknown> = {}) {
  return ociFunctionsInputSchemas.oci_functions_invoke.parse({ ...auth, functionId, ...overrides })
}
function bodyOfCall(index = 0): unknown {
  return JSON.parse(new TextDecoder().decode(mocks.request.mock.calls[index][0].body))
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.create.mockResolvedValue({
    prepareStaticEndpoint: async () => managementEndpoint,
    prepareDiscoveredEndpoint: mocks.discover,
    request: mocks.request,
  })
  mocks.discover.mockResolvedValue(invocationEndpoint)
  mocks.request.mockResolvedValue(response())
  mocks.file.mockReturnValue({ key: 'workspace/file', name: 'input.bin', size: 3 })
  mocks.authorizeFile.mockResolvedValue(null)
  mocks.download.mockResolvedValue({
    buffer: Buffer.from([0, 255, 1]),
    contentType: 'application/octet-stream',
  })
})

describe('OCI Functions management operations', () => {
  it('gets application and function resources using encoded IDs', async () => {
    const ctx = await context()
    await executeOciFunctionsGetApplication({ ...auth, applicationId }, ctx)
    await executeOciFunctionsGetFunction({ ...auth, functionId }, ctx)
    expect(
      mocks.request.mock.calls.map(([request]) => [request.method, request.encodedPath])
    ).toEqual([
      ['GET', `/20181201/applications/${applicationId}`],
      ['GET', `/20181201/functions/${encodeURIComponent(functionId)}`],
    ])
  })

  it('returns one list page and forwards filters and the next token without fetching another page', async () => {
    mocks.request.mockResolvedValue(
      response([{ id: applicationId, displayName: 'Orders' }], 200, {
        'opc-next-page': 'next-token',
      })
    )
    const result = await executeOciFunctionsListApplications(
      ociFunctionsInputSchemas.oci_functions_list_applications.parse({
        ...auth,
        compartmentId: 'compartment-1',
        limit: 50,
        page: 'prior-token',
        displayName: 'Orders',
        lifecycleState: 'ACTIVE',
        sortBy: 'timeCreated',
        sortOrder: 'DESC',
      }),
      await context()
    )
    expect(result.output).toMatchObject({
      applications: [{ id: applicationId, displayName: 'Orders' }],
      nextPage: 'next-token',
    })
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request.mock.calls[0][0].queryPairs).toEqual([
      ['compartmentId', 'compartment-1'],
      ['limit', '50'],
      ['page', 'prior-token'],
      ['displayName', 'Orders'],
      ['lifecycleState', 'ACTIVE'],
      ['sortBy', 'timeCreated'],
      ['sortOrder', 'DESC'],
    ])
  })

  it('scopes function lists to the application with a bounded default page', async () => {
    mocks.request.mockResolvedValue(response([]))
    await executeOciFunctionsListFunctions(
      ociFunctionsInputSchemas.oci_functions_list_functions.parse({ ...auth, applicationId }),
      await context()
    )
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      method: 'GET',
      encodedPath: '/20181201/functions',
      queryPairs: [
        ['applicationId', applicationId],
        ['limit', '10'],
      ],
    })
  })

  it('accepts and forwards the documented INACTIVE function filter', async () => {
    mocks.request.mockResolvedValue(response([]))
    const input = ociFunctionsInputSchemas.oci_functions_list_functions.parse({
      ...auth,
      applicationId,
      lifecycleState: 'INACTIVE',
    })
    await executeOciFunctionsListFunctions(input, await context())
    expect(mocks.request.mock.calls[0][0].queryPairs).toContainEqual(['lifecycleState', 'INACTIVE'])
  })

  it('creates applications and image-based functions without deploying source or passing authentication fields', async () => {
    const ctx = await context()
    await executeOciFunctionsCreateApplication(
      {
        ...auth,
        compartmentId: 'compartment-1',
        displayName: 'Orders',
        subnetIds: ['subnet-1'],
        shape: 'GENERIC_ARM',
        configuration: { config: { ENV: 'production' }, logging: { lineFormat: 'JSON' } },
      },
      ctx
    )
    await executeOciFunctionsCreateFunction(
      {
        ...auth,
        applicationId,
        displayName: 'Process',
        image: 'registry/image:1',
        memoryInMBs: 512,
        configuration: {
          provisionedConcurrencyConfig: { strategy: 'CONSTANT', count: 10 },
          successDestination: {
            destinationType: 'QUEUE',
            queueId: 'queue-1',
            channelId: 'results',
          },
          detachedModeTimeoutInSeconds: 3600,
        },
      },
      ctx
    )
    expect(bodyOfCall()).toEqual({
      compartmentId: 'compartment-1',
      displayName: 'Orders',
      subnetIds: ['subnet-1'],
      shape: 'GENERIC_ARM',
      config: { ENV: 'production' },
      logging: { lineFormat: 'JSON' },
    })
    expect(bodyOfCall(1)).toEqual({
      applicationId,
      displayName: 'Process',
      image: 'registry/image:1',
      memoryInMBs: 512,
      provisionedConcurrencyConfig: { strategy: 'CONSTANT', count: 10 },
      successDestination: { destinationType: 'QUEUE', queueId: 'queue-1', channelId: 'results' },
      detachedModeTimeoutInSeconds: 3600,
    })
    expect(mocks.request.mock.calls.map(([request]) => request.method)).toEqual(['POST', 'POST'])
  })

  it('preserves omitted settings and explicitly clears maps and destinations on updates', async () => {
    const ctx = await context()
    await executeOciFunctionsUpdateApplication(
      {
        ...auth,
        applicationId,
        ifMatch: 'app-etag',
        configuration: { config: {}, freeformTags: {}, networkSecurityGroupIds: [] },
      },
      ctx
    )
    await executeOciFunctionsUpdateFunction(
      {
        ...auth,
        functionId,
        ifMatch: 'function-etag',
        configuration: {
          config: {},
          successDestination: { destinationType: 'NONE' },
          provisionedConcurrencyConfig: { strategy: 'NONE' },
          traceConfig: { isEnabled: false },
        },
      },
      ctx
    )
    expect(bodyOfCall()).toEqual({ config: {}, freeformTags: {}, networkSecurityGroupIds: [] })
    expect(bodyOfCall(1)).toEqual({
      config: {},
      successDestination: { destinationType: 'NONE' },
      provisionedConcurrencyConfig: { strategy: 'NONE' },
      traceConfig: { isEnabled: false },
    })
    expect(mocks.request.mock.calls.map(([request]) => [request.method, request.headers])).toEqual([
      ['PUT', { 'if-match': 'app-etag' }],
      ['PUT', { 'if-match': 'function-etag' }],
    ])
  })

  it('deletes each resource and moves applications with one request and empty 204 responses', async () => {
    mocks.request.mockResolvedValue(response(undefined, 204))
    const ctx = await context()
    const deletedApp = await executeOciFunctionsDeleteApplication({ ...auth, applicationId }, ctx)
    const deletedFn = await executeOciFunctionsDeleteFunction({ ...auth, functionId }, ctx)
    const moved = await executeOciFunctionsChangeApplicationCompartment(
      { ...auth, applicationId, compartmentId: 'destination', ifMatch: 'etag' },
      ctx
    )
    expect(deletedApp.output).toMatchObject({ status: 204, applicationId })
    expect(deletedFn.output).toMatchObject({ status: 204, functionId })
    expect(moved.output).toMatchObject({ status: 204, applicationId, compartmentId: 'destination' })
    expect(mocks.request).toHaveBeenCalledTimes(3)
    expect(mocks.request.mock.calls[2][0]).toMatchObject({
      method: 'POST',
      encodedPath: `/20181201/applications/${applicationId}/actions/changeCompartment`,
      headers: { 'if-match': 'etag' },
    })
    expect(bodyOfCall(2)).toEqual({ compartmentId: 'destination' })
  })
})

describe('OCI Functions invocation', () => {
  it('discovers the endpoint from the same authenticated management response and supplies invocation headers', async () => {
    const discovery = response({ id: functionId, invokeEndpoint: invocationEndpoint.origin })
    mocks.request
      .mockResolvedValueOnce(discovery)
      .mockResolvedValueOnce(response({ ok: true }, 200, { 'content-type': 'application/json' }))
    const controller = new AbortController()
    const result = await executeOciFunctionsInvoke(
      invoke({ payload: { value: 1 }, intent: 'cloudevent', timeoutMs: 120000 }),
      await context(controller.signal)
    )
    expect(mocks.discover).toHaveBeenCalledWith(OCI_FUNCTIONS_INVOCATION_POLICY, discovery)
    expect(OCI_FUNCTIONS_INVOCATION_POLICY.hostnameTemplate).toBe('region-first-oci')
    expect(mocks.request.mock.calls[1][0]).toMatchObject({
      endpoint: invocationEndpoint,
      method: 'POST',
      encodedPath: `/20181201/functions/${encodeURIComponent(functionId)}/actions/invoke`,
      headers: { 'fn-invoke-type': 'sync', 'is-dry-run': 'false', 'fn-intent': 'cloudevent' },
      timeoutMs: 120000,
      signal: controller.signal,
    })
    expect(bodyOfCall(1)).toEqual({ value: 1 })
    expect(result.output).toMatchObject({
      status: 200,
      result: { ok: true },
      opcRequestId: 'oracle-request',
    })
    expect(mocks.request.mock.calls[1][0]).not.toHaveProperty('retry')
  })

  it.each([false, 0, null, ''])(
    'preserves JSON payload and result %j without double encoding',
    async (value) => {
      mocks.request
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(response(value, 200, { 'content-type': 'application/json' }))
      const result = await executeOciFunctionsInvoke(invoke({ payload: value }), await context())
      expect(bodyOfCall(1)).toEqual(value)
      expect(result.output).toHaveProperty('result', value)
    }
  )

  it('preserves text bytes and empty bodies', async () => {
    mocks.request.mockResolvedValueOnce(response()).mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: new Uint8Array(),
    })
    const result = await executeOciFunctionsInvoke(
      invoke({ payloadType: 'text', payload: 'hello 🌍' }),
      await context()
    )
    expect(new TextDecoder().decode(mocks.request.mock.calls[1][0].body)).toBe('hello 🌍')
    expect(result.output).toHaveProperty('result', '')
    mocks.request
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce({ status: 200, headers: {}, body: new Uint8Array() })
    await executeOciFunctionsInvoke(invoke(), await context())
    expect(mocks.request.mock.calls[3][0].body.byteLength).toBe(0)
  })

  it('returns text and uses a file when JSON escaping would exceed the Sim response budget', async () => {
    mocks.request.mockResolvedValueOnce(response()).mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: new TextEncoder().encode('hello 🌍'),
    })
    expect((await executeOciFunctionsInvoke(invoke(), await context())).output).toHaveProperty(
      'result',
      'hello 🌍'
    )
    mocks.request.mockResolvedValueOnce(response()).mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: new Uint8Array(2_000_000),
    })
    const large = await executeOciFunctionsInvoke(invoke(), await context())
    expect(large.output).toHaveProperty('file.size', 2_000_000)
    expect(large.output).not.toHaveProperty('result')
  })

  it('returns an acknowledgement without a fabricated detached result', async () => {
    mocks.request.mockResolvedValueOnce(response()).mockResolvedValueOnce({
      status: 202,
      headers: {},
      opcRequestId: 'detached-request',
      body: new Uint8Array(),
    })
    const result = await executeOciFunctionsInvoke(
      invoke({ invocationType: 'detached' }),
      await context()
    )
    expect(result.output).toEqual({
      status: 202,
      opcRequestId: 'detached-request',
      functionId,
      invocationType: 'detached',
      dryRun: false,
      accepted: true,
    })
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })

  it('sends dry-run without presenting it as a function execution result', async () => {
    mocks.request
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce({ status: 200, headers: {}, body: new Uint8Array() })
    const result = await executeOciFunctionsInvoke(invoke({ dryRun: true }), await context())
    expect(mocks.request.mock.calls[1][0].headers['is-dry-run']).toBe('true')
    expect(result.output).toHaveProperty('dryRun', true)
    expect(result.output).not.toHaveProperty('result')
  })

  it('authorizes uploaded files before downloading and preserves binary bytes in both directions', async () => {
    mocks.request.mockResolvedValueOnce(response()).mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array([0, 255, 1]),
    })
    const file = { key: 'workspace/file', name: 'input.bin', size: 3 }
    const controller = new AbortController()
    const result = await executeOciFunctionsInvoke(
      invoke({ payloadType: 'file', file }),
      await context(controller.signal)
    )
    expect(mocks.authorizeFile).toHaveBeenCalledWith(
      'workspace/file',
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.download).toHaveBeenCalledWith(
      expect.objectContaining(file),
      'request-1',
      expect.anything(),
      { maxBytes: OCI_FUNCTIONS_PAYLOAD_LIMIT, signal: controller.signal }
    )
    expect([...mocks.request.mock.calls[1][0].body]).toEqual([0, 255, 1])
    expect(result.output).toHaveProperty('file', {
      name: 'function-result.bin',
      mimeType: 'application/octet-stream',
      data: 'AP8B',
      size: 3,
    })
  })

  it('parses direct-tool JSON-string file input before authorizing and downloading it', async () => {
    const file = { key: 'workspace/file', name: 'input.bin', size: 3 }
    mocks.request.mockResolvedValueOnce(response()).mockResolvedValueOnce(response(true))
    await executeOciFunctionsInvoke(
      invoke({ payloadType: 'file', file: JSON.stringify(file) }),
      await context()
    )
    expect(mocks.file).toHaveBeenCalledWith(file, 'request-1', expect.anything())
    expect(mocks.authorizeFile).toHaveBeenCalled()
    expect(mocks.download).toHaveBeenCalled()
  })

  it('rejects malformed direct-tool file strings before file or provider access', async () => {
    await expect(
      executeOciFunctionsInvoke(invoke({ payloadType: 'file', file: '{broken' }), await context())
    ).rejects.toThrow('File must be a valid uploaded file object')
    expect(mocks.file).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('stops before download, discovery, or invocation when file access fails', async () => {
    mocks.authorizeFile.mockResolvedValue(new Response(null, { status: 403 }))
    await expect(
      executeOciFunctionsInvoke(
        invoke({ payloadType: 'file', file: { key: 'other/file', name: 'input', size: 1 } }),
        await context()
      )
    ).rejects.toThrow('File is unavailable')
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('supports explicit file output even for JSON', async () => {
    mocks.request
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response(false, 200, { 'content-type': 'application/json' }))
    const result = await executeOciFunctionsInvoke(
      invoke({ outputFormat: 'file' }),
      await context()
    )
    expect(result.output).toHaveProperty('file', {
      name: 'function-result.bin',
      mimeType: 'application/json',
      data: 'ZmFsc2U=',
      size: 5,
    })
    expect(result.output).not.toHaveProperty('result')
  })

  it('preserves an empty successful result even when file output was requested', async () => {
    mocks.request
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce({ status: 200, headers: {}, body: new Uint8Array() })
    const result = await executeOciFunctionsInvoke(
      invoke({ outputFormat: 'file' }),
      await context()
    )
    expect(result.output).toHaveProperty('result', '')
    expect(result.output).not.toHaveProperty('file')
  })

  it('reports file download size-limit failures as a safe 413', async () => {
    mocks.download.mockRejectedValue(
      new PayloadSizeLimitError({
        label: 'private-file-canary',
        maxBytes: OCI_FUNCTIONS_PAYLOAD_LIMIT,
      })
    )
    await expect(
      executeOciFunctionsInvoke(
        invoke({
          payloadType: 'file',
          file: { key: 'workspace/file', name: 'input.bin', size: 3 },
        }),
        await context()
      )
    ).rejects.toMatchObject({ status: 413, message: 'Invocation file exceeds 6 MB' })
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('enforces payload size in UTF-8 bytes before contacting Oracle', async () => {
    await expect(
      executeOciFunctionsInvoke(
        invoke({ payloadType: 'text', payload: 'é'.repeat(OCI_FUNCTIONS_PAYLOAD_LIMIT / 2 + 1) }),
        await context()
      )
    ).rejects.toThrow('Invocation payload exceeds 6 MB')
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('does not replay an invocation after a lost response', async () => {
    mocks.request
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new OciClientError('request_failed'))
    await expect(executeOciFunctionsInvoke(invoke(), await context())).rejects.toThrow(
      'OCI request failed'
    )
    expect(mocks.request).toHaveBeenCalledTimes(2)
    expect(mocks.request.mock.calls[1][0]).not.toHaveProperty('retry')
  })

  it('cancels before discovery or forwards cancellation to an in-flight invocation', async () => {
    const controller = new AbortController()
    const ctx = await context(controller.signal)
    controller.abort()
    await expect(executeOciFunctionsInvoke(invoke(), ctx)).rejects.toThrow()
    expect(mocks.request).not.toHaveBeenCalled()
    const running = new AbortController()
    mocks.request.mockResolvedValueOnce(response()).mockImplementationOnce(async (request) => {
      expect(request.signal).toBe(running.signal)
      running.abort()
      request.signal.throwIfAborted()
    })
    await expect(
      executeOciFunctionsInvoke(invoke(), await context(running.signal))
    ).rejects.toThrow()
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })
})

describe('OCI Functions input contracts', () => {
  it.each([
    { configuration: { timeoutInSeconds: 301 } },
    { configuration: { detachedModeTimeoutInSeconds: 3601 } },
    { configuration: { successDestination: { destinationType: 'QUEUE' } } },
    { configuration: { provisionedConcurrencyConfig: { strategy: 'CONSTANT', count: 0 } } },
    { configuration: { config: { 'invalid-key': 'value' } } },
    { configuration: { config: { KEY: 'é'.repeat(2048) } } },
    { configuration: { config: { KEY: '\n' } } },
    { configuration: { unsupportedSetting: true } },
  ])('rejects invalid function configuration %j', (input) => {
    expect(
      ociFunctionsInputSchemas.oci_functions_update_function.safeParse({
        ...auth,
        functionId,
        ...input,
      }).success
    ).toBe(false)
  })

  it('rejects unbounded pages, malformed payload modes, missing file, and immutable update fields', () => {
    expect(
      ociFunctionsInputSchemas.oci_functions_list_applications.safeParse({
        ...auth,
        compartmentId: 'c',
        limit: 51,
      }).success
    ).toBe(false)
    expect(
      ociFunctionsInputSchemas.oci_functions_invoke.safeParse({
        ...auth,
        functionId,
        payloadType: 'text',
        payload: false,
      }).success
    ).toBe(false)
    expect(
      ociFunctionsInputSchemas.oci_functions_invoke.safeParse({
        ...auth,
        functionId,
        payloadType: 'file',
      }).success
    ).toBe(false)
    expect(
      ociFunctionsInputSchemas.oci_functions_update_application.safeParse({
        ...auth,
        applicationId,
        configuration: { subnetIds: [] },
      }).success
    ).toBe(false)
  })
})
