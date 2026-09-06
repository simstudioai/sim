/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  authorize: vi.fn(),
  file: vi.fn(),
  download: vi.fn(),
  store: vi.fn(),
  copilot: vi.fn(),
}))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: vi.fn() }))
vi.mock('@/app/api/files/authorization', () => ({ assertToolFileAccess: mocks.authorize }))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processSingleFileToUserFile: mocks.file,
  isInternalFileUrl: () => true,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.download,
}))
vi.mock('@/lib/uploads/contexts/execution', () => ({ uploadExecutionFile: mocks.store }))
vi.mock('@/lib/uploads/contexts/copilot/copilot-file-manager', () => ({
  uploadCopilotFile: mocks.copilot,
}))

import type { PreparedOciResourceManagerClient } from '@/lib/internal/oci-resource-manager/client'
import {
  createConfigSourceSchema,
  type OciResourceManagerOperation,
  parseOciResourceManagerInput,
  updateConfigSourceSchema,
} from '@/lib/internal/oci-resource-manager/input'
import {
  executeOciResourceManagerOperation,
  OCI_RESOURCE_MANAGER_MUTATIONS,
  type OciResourceManagerContext,
  projectResource,
} from '@/lib/internal/oci-resource-manager/operations'

const auth = { oauthCredential: 'credential' }
const stored = {
  id: 'file',
  key: 'execution/file',
  name: 'input.zip',
  size: 3,
  type: 'application/zip',
  url: '/api/files/serve/execution/file',
}
const context: OciResourceManagerContext = {
  prepared: {
    client: { request: mocks.request },
    endpoint: {},
  } as unknown as PreparedOciResourceManagerClient,
  userId: 'actor',
  workspaceId: 'workspace',
  workflowId: 'workflow',
  executionId: 'execution',
  requestId: 'request',
}
function response(body: unknown, status = 200, headers = {}) {
  return {
    status,
    headers,
    opcRequestId: 'oracle-request',
    body: new TextEncoder().encode(JSON.stringify(body)),
  }
}
async function run(operation: OciResourceManagerOperation, values: object) {
  return executeOciResourceManagerOperation(
    operation,
    parseOciResourceManagerInput(operation, { ...auth, ...values }),
    context
  )
}
function body(index = 0) {
  return JSON.parse(new TextDecoder().decode(mocks.request.mock.calls[index][0].body))
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.request.mockResolvedValue(
    response({ id: 'new-job', stackId: 'stack', operation: 'PLAN', lifecycleState: 'ACCEPTED' })
  )
  mocks.authorize.mockResolvedValue(null)
  mocks.file.mockReturnValue(stored)
  mocks.download.mockResolvedValue({ buffer: Buffer.from('zip'), contentType: 'application/zip' })
  mocks.store.mockResolvedValue(stored)
})
describe('configuration source contracts', () => {
  const sources = [
    { configSourceType: 'ZIP_UPLOAD' },
    {
      configSourceType: 'GIT_CONFIG_SOURCE',
      configurationSourceProviderId: 'provider',
      repositoryUrl: 'https://example.com/repo.git',
    },
    {
      configSourceType: 'BITBUCKET_CLOUD_CONFIG_SOURCE',
      configurationSourceProviderId: 'provider',
      repositoryUrl: 'https://example.com/repo.git',
      workspaceId: 'bitbucket-workspace',
    },
    {
      configSourceType: 'BITBUCKET_SERVER_CONFIG_SOURCE',
      configurationSourceProviderId: 'provider',
      repositoryUrl: 'https://example.com/repo.git',
    },
    { configSourceType: 'DEVOPS_CONFIG_SOURCE', projectId: 'project', repositoryId: 'repo' },
    {
      configSourceType: 'OBJECT_STORAGE_CONFIG_SOURCE',
      region: 'us-ashburn-1',
      namespace: 'namespace',
      bucketName: 'bucket',
    },
    { configSourceType: 'TEMPLATE_CONFIG_SOURCE', templateId: 'template' },
    {
      configSourceType: 'COMPARTMENT_CONFIG_SOURCE',
      compartmentId: 'source-compartment',
      region: 'us-ashburn-1',
      servicesToDiscover: ['core'],
    },
  ]
  it.each(sources)('sends the documented $configSourceType source', async (configSource) => {
    mocks.request.mockResolvedValue(response({ id: 'stack', lifecycleState: 'CREATING' }))
    await run('create_stack', {
      compartmentId: 'destination',
      configSource,
      ...(configSource.configSourceType === 'ZIP_UPLOAD' ? { file: stored } : {}),
    })
    expect(body().configSource).toEqual(
      configSource.configSourceType === 'ZIP_UPLOAD'
        ? { ...configSource, zipFileBase64Encoded: 'emlw' }
        : configSource
    )
    expect(body().compartmentId).toBe('destination')
    expect(body()).not.toHaveProperty('jobOperationDetails')
  })
  it('distinguishes create/update fields and rejects nonexistent object keys', () => {
    expect(
      createConfigSourceSchema.safeParse({ configSourceType: 'OBJECT_STORAGE_CONFIG_SOURCE' })
        .success
    ).toBe(false)
    expect(
      updateConfigSourceSchema.safeParse({ configSourceType: 'OBJECT_STORAGE_CONFIG_SOURCE' })
        .success
    ).toBe(true)
    expect(
      updateConfigSourceSchema.safeParse({ configSourceType: 'BITBUCKET_CLOUD_CONFIG_SOURCE' })
        .success
    ).toBe(false)
    expect(
      updateConfigSourceSchema.safeParse({
        configSourceType: 'BITBUCKET_CLOUD_CONFIG_SOURCE',
        configurationSourceProviderId: 'p',
      }).success
    ).toBe(true)
    expect(
      updateConfigSourceSchema.safeParse({
        configSourceType: 'TEMPLATE_CONFIG_SOURCE',
        templateId: 't',
      }).success
    ).toBe(false)
    expect(
      createConfigSourceSchema.safeParse({ ...sources[5], objectName: 'config.zip' }).success
    ).toBe(false)
  })
  it.each([
    { configSourceType: 'ZIP_UPLOAD', workingDirectory: 'root' },
    { configSourceType: 'GIT_CONFIG_SOURCE', configurationSourceProviderId: 'provider' },
    {
      configSourceType: 'BITBUCKET_CLOUD_CONFIG_SOURCE',
      configurationSourceProviderId: 'provider',
    },
    {
      configSourceType: 'BITBUCKET_SERVER_CONFIG_SOURCE',
      configurationSourceProviderId: 'provider',
    },
    { configSourceType: 'DEVOPS_CONFIG_SOURCE', projectId: 'project', repositoryId: 'repo' },
    { configSourceType: 'OBJECT_STORAGE_CONFIG_SOURCE', bucketName: 'replacement' },
  ])(
    'updates the documented $configSourceType source without inserting defaults',
    async (configSource) => {
      mocks.request.mockResolvedValue(response({ id: 'stack' }))
      await run('update_stack', { stackId: 'stack', configSource })
      expect(body()).toEqual({ configSource })
      expect(mocks.download).not.toHaveBeenCalled()
    }
  )
  it.each([
    'GIT_CONFIG_SOURCE',
    'BITBUCKET_CLOUD_CONFIG_SOURCE',
    'BITBUCKET_SERVER_CONFIG_SOURCE',
    'DEVOPS_CONFIG_SOURCE',
  ])('requires source identifiers when updating %s', (configSourceType) => {
    expect(updateConfigSourceSchema.safeParse({ configSourceType }).success).toBe(false)
  })
  it('rejects configuration files without an explicit ZIP source before provider access', async () => {
    await expect(run('update_stack', { stackId: 'stack', file: stored })).rejects.toThrow(
      'ZIP_UPLOAD source'
    )
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('rejects inline configuration bytes, unconfirmed mutations, and ambiguous plan resolution', () => {
    expect(() =>
      parseOciResourceManagerInput('create_stack', {
        ...auth,
        compartmentId: 'c',
        configSource: { configSourceType: 'ZIP_UPLOAD', zipFileBase64Encoded: 'secret' },
      })
    ).toThrow()
    expect(() => parseOciResourceManagerInput('destroy', { ...auth, stackId: 'stack' })).toThrow()
    expect(() =>
      parseOciResourceManagerInput('apply', {
        ...auth,
        stackId: 'stack',
        confirmApply: true,
        executionPlanStrategy: 'FROM_PLAN_JOB_ID',
      })
    ).toThrow()
    expect(() =>
      parseOciResourceManagerInput('cancel_job', { ...auth, jobId: 'job', isForced: true })
    ).toThrow()
  })
})
describe('job requests and replay classification', () => {
  it.each([
    ['plan', {}, { operation: 'PLAN' }],
    [
      'apply',
      { confirmApply: true, executionPlanStrategy: 'AUTO_APPROVED' },
      { operation: 'APPLY', executionPlanStrategy: 'AUTO_APPROVED' },
    ],
    [
      'destroy',
      { confirmDestroy: true },
      { operation: 'DESTROY', executionPlanStrategy: 'AUTO_APPROVED' },
    ],
    [
      'import_state',
      { file: stored, confirmStateReplacement: true },
      { operation: 'IMPORT_TF_STATE', tfStateBase64Encoded: 'emlw' },
    ],
  ] as const)(
    'submits %s once with canonical operation details',
    async (operation, values, details) => {
      await run(operation, { stackId: 'stack', ...values })
      expect(body()).toEqual({ stackId: 'stack', jobOperationDetails: details })
      expect(mocks.request).toHaveBeenCalledTimes(1)
      expect(mocks.request.mock.calls[0][0].retry).toBeUndefined()
      expect(OCI_RESOURCE_MANAGER_MUTATIONS.has(operation)).toBe(true)
    }
  )
  it.each([
    [
      'apply',
      {
        executionPlanJobId: 'prior',
        executionPlanStrategy: 'FROM_PLAN_JOB_ID',
        confirmApply: true,
      },
      'PLAN',
    ],
    ['plan_rollback', { targetRollbackJobId: 'prior' }, 'APPLY'],
    [
      'apply_rollback',
      { executionPlanRollbackJobId: 'prior', confirmApply: true },
      'PLAN_ROLLBACK',
    ],
  ] as const)(
    'validates selected job scope and status before %s',
    async (operation, values, expected) => {
      mocks.request.mockResolvedValueOnce(
        response({
          id: 'prior',
          stackId: 'other-stack',
          operation: expected,
          lifecycleState: 'SUCCEEDED',
        })
      )
      await expect(run(operation, { stackId: 'stack', ...values })).rejects.toThrow('same stack')
      expect(mocks.request).toHaveBeenCalledTimes(1)
      mocks.request.mockClear()
      mocks.request.mockResolvedValueOnce(
        response({
          id: 'prior',
          stackId: 'stack',
          operation: expected,
          lifecycleState: 'SUCCEEDED',
        })
      )
      await run(operation, { stackId: 'stack', ...values })
      const details =
        operation === 'apply'
          ? {
              operation: 'APPLY',
              executionPlanStrategy: 'FROM_PLAN_JOB_ID',
              executionPlanJobId: 'prior',
            }
          : operation === 'plan_rollback'
            ? { operation: 'PLAN_ROLLBACK', targetRollbackJobId: 'prior' }
            : {
                operation: 'APPLY_ROLLBACK',
                executionPlanRollbackStrategy: 'FROM_PLAN_ROLLBACK_JOB_ID',
                executionPlanRollbackJobId: 'prior',
              }
      expect(body(1)).toEqual({ stackId: 'stack', jobOperationDetails: details })
      expect(body(1).jobOperationDetails).not.toHaveProperty('confirmApply')
    }
  )
  it('uses DELETE/202 for cancellation, and preserves work-request identity without parsing an empty body', async () => {
    mocks.request.mockResolvedValue({
      status: 202,
      headers: { 'opc-work-request-id': 'work' },
      body: new Uint8Array(),
    })
    const result = await run('cancel_job', { jobId: 'job', isForced: false, ifMatch: 'etag' })
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        encodedPath: '/20180917/jobs/job',
        queryPairs: [['isForced', 'false']],
      })
    )
    expect(result.output).toMatchObject({ accepted: true, jobId: 'job', workRequestId: 'work' })
  })
  it('classifies drift listing as read-only and sends repeated filters with an empty POST body', async () => {
    mocks.request.mockResolvedValue(response({ items: [] }, 200, { 'opc-next-page': 'next' }))
    const result = await run('list_drift_details', {
      stackId: 'stack',
      resourceDriftStatus: ['MODIFIED', 'DELETED'],
    })
    expect(mocks.request.mock.calls[0][0].body).toEqual(new Uint8Array())
    expect(mocks.request.mock.calls[0][0].queryPairs).toContainEqual([
      'resourceDriftStatus',
      'DELETED',
    ])
    expect(result.output.nextPage).toBe('next')
    expect(OCI_RESOURCE_MANAGER_MUTATIONS.has('list_drift_details')).toBe(false)
  })
})
describe('files and deliberate projections', () => {
  it('denies unauthorized files before storage reads or provider submission', async () => {
    mocks.authorize.mockResolvedValue({ status: 404 })
    await expect(
      run('import_state', { stackId: 'stack', file: stored, confirmStateReplacement: true })
    ).rejects.toThrow('File not found')
    expect(mocks.authorize).toHaveBeenCalledWith(stored.key, 'actor', 'request', expect.anything())
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('bounds actual ZIP reads and rejects declared oversize data', async () => {
    mocks.file.mockReturnValue({ ...stored, size: 11_000_001 })
    await expect(
      run('create_stack', {
        compartmentId: 'c',
        configSource: { configSourceType: 'ZIP_UPLOAD' },
        file: stored,
      })
    ).rejects.toThrow('byte limit')
    expect(mocks.download).not.toHaveBeenCalled()
    mocks.file.mockReturnValue(stored)
    mocks.request.mockResolvedValue(response({ id: 'stack' }))
    await run('create_stack', {
      compartmentId: 'c',
      configSource: { configSourceType: 'ZIP_UPLOAD' },
      file: stored,
    })
    expect(mocks.download).toHaveBeenCalledWith(
      stored,
      'request',
      expect.anything(),
      expect.objectContaining({ maxBytes: 11_000_000 })
    )
  })
  it('stores opaque plan/state bytes before returning a small file-reference envelope', async () => {
    const bytes = new Uint8Array([0, 255, 1, 128])
    mocks.request.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
    })
    const result = await run('download_plan', { jobId: 'job', tfPlanFormat: 'JSON' })
    expect(mocks.store).toHaveBeenCalledWith(
      { workspaceId: 'workspace', workflowId: 'workflow', executionId: 'execution' },
      Buffer.from(bytes),
      'resource-manager-plan.json',
      'application/octet-stream',
      'actor'
    )
    expect(result.output.file).toEqual(stored)
    expect(JSON.stringify(result)).not.toContain('base64')
    expect(result.output).not.toHaveProperty('data')
  })
  it('omits variable contents, source data and raw failure messages by default', () => {
    const result = projectResource('job', {
      id: 'job',
      stackId: 'stack',
      variables: { secret: 'canary' },
      configSource: { commitId: 'commit' },
      failureDetails: { code: 'Failure', message: 'canary' },
    })
    expect(result).not.toHaveProperty('variables')
    expect(result).not.toHaveProperty('configSource')
    expect(result.failureDetails).toEqual({ code: 'Failure' })
    expect(JSON.stringify(result)).not.toContain('canary')
  })
  it('reveals only selected outputs and treats missing sensitivity as unknown', async () => {
    mocks.request.mockResolvedValue(
      response({
        items: [
          { outputName: 'public', outputType: 'string', outputValue: 'value', isSensitive: false },
          { outputName: 'unknown', outputValue: 'secret' },
          { outputName: 'hidden', outputValue: 'secret', isSensitive: true },
        ],
      })
    )
    const result = await run('list_job_outputs', {
      jobId: 'job',
      includeValues: true,
      outputNames: ['public', 'unknown'],
    })
    expect(result.output.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outputName: 'public', outputValue: 'value' }),
      ])
    )
    expect(JSON.stringify(result)).not.toContain('secret')
  })
  it('omits log messages and drift properties unless explicitly requested', async () => {
    mocks.request.mockResolvedValueOnce(
      response([{ timestamp: '2026-01-01T00:00:00Z', message: 'canary' }])
    )
    expect(JSON.stringify(await run('get_job_logs', { jobId: 'job' }))).not.toContain('canary')
    mocks.request.mockResolvedValueOnce(
      response({
        items: [
          {
            resourceId: 'r',
            actualProperties: { password: 'canary' },
            expectedProperties: { password: 'canary' },
          },
        ],
      })
    )
    expect(JSON.stringify(await run('list_drift_details', { stackId: 'stack' }))).not.toContain(
      'canary'
    )
  })
})
