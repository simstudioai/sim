/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  createClient: vi.fn(),
  prepare: vi.fn(),
  request: vi.fn(),
}))
vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUseForAuth: mocks.authorize,
}))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.createClient }))

import { OciClientError } from '@/lib/internal/oci/errors'
import { executeOciDevopsOperation } from '@/lib/internal/oci-devops/operations'
import type { OciDevopsAction } from '@/tools/oci_devops/types'

const context = { userId: 'actor', workspaceId: 'workspace', workflowId: 'workflow' }
const credential = { oauthCredential: 'legacy-reference' }
function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    status,
    headers,
    opcRequestId: 'request-1',
    body: new TextEncoder().encode(JSON.stringify(body)),
  }
}
function execute(action: OciDevopsAction, input: Record<string, unknown> = {}) {
  return executeOciDevopsOperation(action, { ...credential, ...input }, context)
}

describe('OCI DevOps operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({
      ok: true,
      resolvedCredentialId: 'authoritative-id',
      workspaceId: 'workspace',
      credentialType: 'service_account',
    })
    mocks.createClient.mockResolvedValue({
      prepareStaticEndpoint: mocks.prepare,
      request: mocks.request,
    })
    mocks.prepare.mockResolvedValue({ hostname: 'devops.us-ashburn-1.oci.oraclecloud.com' })
    mocks.request.mockResolvedValue(response({ id: 'resource' }))
  })

  it('authorizes the trusted actor and passes only the resolved credential ID to the client', async () => {
    await execute('get_project', { projectId: 'project', region: 'us-ashburn-1' })
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, userId: 'actor' }),
      {
        credentialId: 'legacy-reference',
        callerUserId: 'actor',
        workspaceId: 'workspace',
        workflowId: 'workflow',
      }
    )
    expect(mocks.createClient).toHaveBeenCalledWith({
      credentialId: 'authoritative-id',
      workspaceId: 'workspace',
      serviceId: 'oci',
      region: 'us-ashburn-1',
    })
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ serviceName: 'devops' }))
  })

  it.each([
    { ok: false },
    { ok: true, workspaceId: 'other', resolvedCredentialId: 'id' },
    { ok: true, workspaceId: 'workspace' },
  ])(
    'fails closed before client creation for unauthorized credential resolution: %j',
    async (access) => {
      mocks.authorize.mockResolvedValue(access)
      await expect(execute('get_project', { projectId: 'p' })).rejects.toMatchObject({
        status: 403,
      })
      expect(mocks.createClient).not.toHaveBeenCalled()
    }
  )

  it('requires trusted workspace and actor context', async () => {
    await expect(
      executeOciDevopsOperation(
        'get_project',
        { ...credential, projectId: 'p' },
        {
          workflowId: 'workflow',
        }
      )
    ).rejects.toMatchObject({ status: 401 })
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('preserves foundation provider rejection without attempting a request', async () => {
    mocks.createClient.mockRejectedValue(new OciClientError('credential_unavailable'))
    await expect(execute('get_project', { projectId: 'p' })).rejects.toThrow(
      'OCI credential is unavailable'
    )
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('encodes path segments and forwards one opaque provider page', async () => {
    mocks.request.mockResolvedValue(
      response(
        { items: [{ refName: 'main', fullRefName: 'refs/heads/main', repositoryId: 'repo/a' }] },
        200,
        { 'opc-next-page': 'opaque+/=' }
      )
    )
    const result = await execute('list_refs', {
      repositoryId: 'repo/a',
      page: 'cursor+/=',
      refName: 'release/x',
    })
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        encodedPath: '/20210630/repositories/repo%2Fa/refs',
        queryPairs: expect.arrayContaining([
          ['limit', '50'],
          ['page', 'cursor+/='],
          ['refName', 'release/x'],
        ]),
        retry: { kind: 'safe', maxAttempts: 3 },
        timeoutMs: 30_000,
        maxResponseBytes: 2 * 1024 * 1024,
      })
    )
    expect(result.output.nextPage).toBe('opaque+/=')
    expect(mocks.request).toHaveBeenCalledOnce()
  })

  it('submits a build with a caller-stable retry token, preserving acceptance and ETag', async () => {
    mocks.request.mockResolvedValue(
      response({ id: 'run', lifecycleState: 'ACCEPTED' }, 200, { etag: 'version-1' })
    )
    const result = await execute('create_build_run', {
      buildPipelineId: 'pipeline',
      retryToken: 'submission-1',
    })
    const request = mocks.request.mock.calls[0][0]
    expect(request.retry).toEqual({ kind: 'tokenized', retryToken: 'submission-1', maxAttempts: 3 })
    expect(JSON.parse(new TextDecoder().decode(request.body))).toEqual({
      buildPipelineId: 'pipeline',
    })
    expect(result.output).toMatchObject({
      accepted: true,
      etag: 'version-1',
      resource: { id: 'run', terminal: false, succeeded: null },
    })
    expect(mocks.request).toHaveBeenCalledOnce()
  })

  it('does not resubmit after an ambiguous transport failure', async () => {
    mocks.request.mockRejectedValue(new OciClientError('deadline_exceeded'))
    await expect(
      execute('create_build_run', { buildPipelineId: 'p', retryToken: 'stable' })
    ).rejects.toThrow('deadline exceeded')
    expect(mocks.request).toHaveBeenCalledOnce()
  })

  it('sends an empty byte body for connection validation and strips credentials and diagnostics', async () => {
    mocks.request.mockResolvedValue(
      response({
        id: 'connection',
        accessToken: 'secret',
        appPassword: 'secret',
        lastConnectionValidationResult: {
          result: 'FAIL',
          message: 'sensitive diagnostic',
          timeValidated: '2026-09-05T00:00:00Z',
        },
      })
    )
    const result = await execute('validate_connection', {
      connectionId: 'connection',
      retryToken: 'stable',
      ifMatch: 'etag',
    })
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      body: new Uint8Array(),
      headers: { 'if-match': 'etag' },
    })
    expect(result.output.resource?.lastConnectionValidationResult).toEqual({
      result: 'FAIL',
      timeValidated: '2026-09-05T00:00:00Z',
    })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('sensitive diagnostic')
  })

  it('translates a Vault reference into the documented connection body field', async () => {
    mocks.request.mockResolvedValue(
      response({ id: 'connection' }, 201, { 'opc-work-request-id': 'work' })
    )
    const result = await execute('create_connection', {
      projectId: 'project',
      retryToken: 'stable',
      connection: {
        connectionType: 'GITHUB_ACCESS_TOKEN',
        secretId: 'ocid1.vaultsecret.oc1..example',
      },
    })
    expect(JSON.parse(new TextDecoder().decode(mocks.request.mock.calls[0][0].body))).toEqual({
      projectId: 'project',
      connectionType: 'GITHUB_ACCESS_TOKEN',
      accessToken: 'ocid1.vaultsecret.oc1..example',
    })
    expect(result.output.workRequestId).toBe('work')
  })

  it('never retries a non-tokenized update or refreshes a rejected ETag', async () => {
    mocks.request.mockRejectedValue(new OciClientError('request_failed', { status: 412 }))
    await expect(
      execute('update_project', { projectId: 'p', ifMatch: 'stale', description: 'changed' })
    ).rejects.toMatchObject({ status: 412 })
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      method: 'PUT',
      headers: { 'if-match': 'stale' },
    })
    expect(mocks.request.mock.calls[0][0].retry).toBeUndefined()
    expect(mocks.request).toHaveBeenCalledOnce()
  })

  it('returns asynchronous delete headers without parsing an empty response', async () => {
    mocks.request.mockResolvedValue({
      ...response(null, 202, { 'opc-work-request-id': 'work' }),
      body: new Uint8Array(),
    })
    const result = await execute('delete_repository', { repositoryId: 'repo', ifMatch: 'etag' })
    expect(result.output).toMatchObject({ accepted: true, workRequestId: 'work' })
    expect(mocks.request.mock.calls[0][0].body).toBeUndefined()
    expect(mocks.request.mock.calls[0][0].retry).toBeUndefined()
  })

  it.each([
    ['ACCEPTED', false, null],
    ['IN_PROGRESS', false, null],
    ['CANCELING', false, null],
    ['CANCELED', true, false],
    ['FAILED', true, false],
    ['SUCCEEDED', true, true],
    ['FUTURE_STATE', false, null],
  ])('preserves execution lifecycle %s in one bounded read', async (state, terminal, succeeded) => {
    mocks.request.mockResolvedValue(response({ id: 'run', lifecycleState: state }))
    const result = await execute('get_build_run', { buildRunId: 'run' })
    expect(result.output.resource).toMatchObject({ lifecycleState: state, terminal, succeeded })
    expect(mocks.request).toHaveBeenCalledOnce()
  })

  it('preserves cancellation as a pending state with the documented reason', async () => {
    mocks.request.mockResolvedValue(response({ id: 'run', lifecycleState: 'CANCELING' }, 202))
    const result = await execute('cancel_build_run', {
      buildRunId: 'run',
      reason: 'Release superseded',
      retryToken: 'cancel-1',
      ifMatch: 'etag',
    })
    expect(JSON.parse(new TextDecoder().decode(mocks.request.mock.calls[0][0].body))).toEqual({
      reason: 'Release superseded',
    })
    expect(result.output.resource?.terminal).toBe(false)
  })

  it('bounds work-request scheduling hints and omits error messages', async () => {
    mocks.request
      .mockResolvedValueOnce(
        response({ id: 'work', status: 'WAITING' }, 200, { 'retry-after': '900' })
      )
      .mockResolvedValueOnce(
        response({ items: [{ code: 'Failure', message: 'sensitive', timestamp: 'now' }] })
      )
    expect((await execute('get_work_request', { workRequestId: 'work' })).output).toMatchObject({
      retryAfterSeconds: 300,
      resource: { status: 'WAITING', terminal: false },
    })
    expect(
      (await execute('list_work_request_errors', { workRequestId: 'work' })).output.items?.[0]
    ).toEqual({ code: 'Failure', timestamp: 'now', terminal: false, succeeded: null })
  })

  it('retains bounded stage progress while dropping sensitive nested fields', async () => {
    mocks.request.mockResolvedValue(
      response({
        id: 'run',
        buildRunArguments: { items: [{ name: 'TOKEN', value: 'private' }] },
        buildRunProgress: {
          buildPipelineStageRunProgress: {
            stage: {
              buildPipelineStageId: 'stage',
              status: 'FAILED',
              logs: 'private',
              buildOutputs: 'private',
            },
          },
        },
        lifecycleDetails: 'private',
      })
    )
    const result = await execute('get_build_run', { buildRunId: 'run' })
    expect(result.output.resource?.buildRunProgress?.buildPipelineStageRunProgress?.stage).toEqual({
      buildPipelineStageId: 'stage',
      status: 'FAILED',
    })
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('retains repository path metadata without following submodule URLs', async () => {
    mocks.request.mockResolvedValue(
      response({
        items: [
          {
            path: 'src',
            type: 'TREE',
            sha: 'abc',
            sizeInBytes: 10,
            submoduleGitUrl: 'https://secret@example.com',
          },
        ],
      })
    )
    expect((await execute('list_paths', { repositoryId: 'repo' })).output.items?.[0]).toEqual({
      path: 'src',
      type: 'TREE',
      sha: 'abc',
      sizeInBytes: 10,
      terminal: false,
      succeeded: null,
    })
  })

  it('rejects oversized provider pages and invalid cursor headers without fetching more', async () => {
    mocks.request
      .mockResolvedValueOnce(response({ items: Array.from({ length: 101 }, () => ({ id: 'p' })) }))
      .mockResolvedValueOnce(response({ items: [] }, 200, { 'opc-next-page': 'x'.repeat(4097) }))
    await expect(execute('list_projects', { compartmentId: 'c' })).rejects.toMatchObject({
      status: 502,
    })
    await expect(execute('list_projects', { compartmentId: 'c' })).rejects.toMatchObject({
      status: 502,
    })
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })

  it('returns requested repository statistics', async () => {
    mocks.request.mockResolvedValue(
      response({ id: 'repo', branchCount: 3, commitCount: 20, sizeInBytes: 100 })
    )
    const result = await execute('get_repository', {
      repositoryId: 'repo',
      fields: ['branchCount', 'commitCount', 'sizeInBytes'],
    })
    expect(result.output.resource).toMatchObject({
      branchCount: 3,
      commitCount: 20,
      sizeInBytes: 100,
    })
    expect(mocks.request.mock.calls[0][0].queryPairs).toEqual([
      ['fields', 'branchCount'],
      ['fields', 'commitCount'],
      ['fields', 'sizeInBytes'],
    ])
  })

  it('repeats the official work-request operation filter wire key', async () => {
    mocks.request.mockResolvedValue(response({ items: [] }))
    await execute('list_work_requests', {
      compartmentId: 'compartment',
      operationTypeMultiValueQuery: ['CREATE_PROJECT', 'UPDATE_PROJECT'],
    })
    expect(mocks.request.mock.calls[0][0].queryPairs).toEqual(
      expect.arrayContaining([
        ['operationTypeMultiValueQuery', 'CREATE_PROJECT'],
        ['operationTypeMultiValueQuery', 'UPDATE_PROJECT'],
      ])
    )
  })
})
