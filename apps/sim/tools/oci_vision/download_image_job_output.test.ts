/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  request: vi.fn(),
  prepare: vi.fn(),
  principal: vi.fn(),
  attribution: vi.fn(),
  subject: vi.fn(),
  executionUpload: vi.fn(),
  copilotUpload: vi.fn(),
}))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.client }))
vi.mock('@/lib/internal/oci-vision/image-input', () => ({ readOciVisionImage: vi.fn() }))
vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.principal,
}))
vi.mock('@sim/auth/principal', () => ({
  resolvePrincipalAttribution: mocks.attribution,
  resolvePrincipalSubject: mocks.subject,
}))
vi.mock('@/lib/uploads/contexts/execution', () => ({ uploadExecutionFile: mocks.executionUpload }))
vi.mock('@/lib/uploads/contexts/copilot', () => ({ uploadCopilotFile: mocks.copilotUpload }))

import {
  executeOciVisionOperation,
  type OciVisionOperationContext,
} from '@/lib/internal/oci-vision/operations'
import { ociVisionInputSchema } from '@/lib/internal/oci-vision/schema'

const context = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  executorDelegationOrigin: { kind: 'workflow' },
  headers: new Headers(),
  requestId: 'request-1',
} as unknown as OciVisionOperationContext
const input = {
  credentialId: 'credential-1',
  operation: 'download_image_job_output',
  imageJobId: 'job-1',
  objectName: 'vision/run/a b%?.json',
  ifMatch: 'etag-1',
}
const job = {
  id: 'job-1',
  compartmentId: 'compartment-1',
  lifecycleState: 'SUCCEEDED',
  timeAccepted: '2026-09-01T00:00:00Z',
  outputLocation: { namespaceName: 'namespace', bucketName: 'bucket', prefix: 'vision/run/' },
}
const file = {
  id: 'file-1',
  name: 'a b%?.json',
  size: 3,
  type: 'application/json',
  key: 'execution/workspace-1/file-1',
}
function jobResponse(value: unknown = job) {
  return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(value)) }
}
function execute(value: unknown = input, executionContext = context) {
  return executeOciVisionOperation(ociVisionInputSchema.parse(value), executionContext)
}

describe('OCI Vision batch output download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.client.mockResolvedValue({ request: mocks.request, prepareStaticEndpoint: mocks.prepare })
    mocks.prepare.mockResolvedValue({
      region: { id: 'us-ashburn-1', realm: 'oc1' },
      origin: 'https://oracle.example',
    })
    mocks.principal.mockResolvedValue({ kind: 'principal' })
    mocks.attribution.mockReturnValue({ attributedUserId: 'user-1' })
    mocks.subject.mockReturnValue({ kind: 'sim_user', userId: 'user-1' })
    mocks.executionUpload.mockResolvedValue(file)
    mocks.copilotUpload.mockResolvedValue(file)
    mocks.request.mockResolvedValueOnce(jobResponse()).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json', etag: 'etag-1' },
      body: Buffer.from('{}\n'),
    })
  })

  it('scopes to the returned job location and downloads encoded object names as one UserFile', async () => {
    const result = await execute()
    expect(mocks.request.mock.calls[1][0]).toMatchObject({
      encodedPath: '/n/namespace/b/bucket/o/vision%2Frun%2Fa%20b%25%3F.json',
      headers: { 'if-match': 'etag-1' },
      maxResponseBytes: 50 * 1024 * 1024,
      retry: { kind: 'safe', maxAttempts: 3 },
    })
    expect(mocks.executionUpload).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', workflowId: 'workflow-1', executionId: 'execution-1' },
      Buffer.from('{}\n'),
      'a b%?.json',
      'application/json',
      'user-1'
    )
    expect(result.output).toMatchObject({ file, size: 3, etag: 'etag-1' })
    expect(result.output).not.toHaveProperty('body')
    expect(result.output).not.toHaveProperty('data')
  })

  it('uses the existing Copilot file flow for authenticated Copilot calls', async () => {
    await execute(input, { ...context, executionId: undefined, copilotToolExecution: true })
    expect(mocks.copilotUpload).toHaveBeenCalledWith({
      buffer: Buffer.from('{}\n'),
      fileName: 'a b%?.json',
      contentType: 'application/json',
      userId: 'user-1',
    })
    expect(mocks.executionUpload).not.toHaveBeenCalled()
  })

  it('rejects an object outside the exact lexical prefix before object access', async () => {
    await expect(execute({ ...input, objectName: 'vision/run-other/a.json' })).rejects.toThrow(
      'job output prefix'
    )
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.executionUpload).not.toHaveBeenCalled()
  })

  it.each([
    { ...job, id: 'different-job' },
    { ...job, outputLocation: { ...job.outputLocation, prefix: '' } },
  ])('rejects broad or mismatched job output scope %#', async (value) => {
    mocks.request.mockReset().mockResolvedValueOnce(jobResponse(value))
    await expect(execute()).rejects.toThrow('matching job with a nonempty output prefix')
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it('fails before downloading when file-output authority is unavailable', async () => {
    await expect(
      execute(input, { ...context, executorDelegationOrigin: undefined })
    ).rejects.toThrow('Trusted execution context')
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it('enforces actual byte size even if metadata understates it', async () => {
    mocks.request
      .mockReset()
      .mockResolvedValueOnce(jobResponse())
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-length': '1' },
        body: Buffer.alloc(50 * 1024 * 1024 + 1),
      })
    await expect(execute()).rejects.toThrow()
    expect(mocks.executionUpload).not.toHaveBeenCalled()
  })

  it('does not retry at the operation level or upload after a download failure', async () => {
    mocks.request
      .mockReset()
      .mockResolvedValueOnce(jobResponse())
      .mockRejectedValueOnce(new Error('Download failed'))
    await expect(execute()).rejects.toThrow('Download failed')
    expect(mocks.request).toHaveBeenCalledTimes(2)
    expect(mocks.executionUpload).not.toHaveBeenCalled()
  })

  it('stops before file materialization after execution cancellation', async () => {
    const controller = new AbortController()
    mocks.request
      .mockReset()
      .mockResolvedValueOnce(jobResponse())
      .mockImplementationOnce(async () => {
        controller.abort(new Error('Stopped'))
        return { status: 200, headers: {}, body: Buffer.from('{}') }
      })
    await expect(execute(input, { ...context, signal: controller.signal })).rejects.toThrow(
      'Stopped'
    )
    expect(mocks.executionUpload).not.toHaveBeenCalled()
  })
})
