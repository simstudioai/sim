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

  it.each([
    ['list_build_pipelines', 'buildPipelines'],
    ['list_connections', 'connections'],
    ['list_deploy_artifacts', 'deployArtifacts'],
    ['list_deploy_environments', 'deployEnvironments'],
    ['list_deploy_pipelines', 'deployPipelines'],
    ['list_repositories', 'repositories'],
    ['list_triggers', 'triggers'],
  ] as const)(
    '%s lists an empty compartment without requiring a project',
    async (operation, resource) => {
      mocks.request.mockResolvedValue(response({ items: [] }))
      await execute(operation, { compartmentId: 'compartment' })
      expect(mocks.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          encodedPath: `/20210630/${resource}`,
          queryPairs: [
            ['compartmentId', 'compartment'],
            ['limit', '50'],
          ],
        })
      )
    }
  )

  it.each([200, 202])(
    'submits a build with HTTP %i and a stable token, preserving acceptance and ETag',
    async (status) => {
      mocks.request.mockResolvedValue(
        response({ id: 'run', lifecycleState: 'ACCEPTED' }, status, { etag: 'version-1' })
      )
      const result = await execute('create_build_run', {
        buildPipelineId: 'pipeline',
        retryToken: 'submission-1',
      })
      const request = mocks.request.mock.calls[0][0]
      expect(request.retry).toEqual({
        kind: 'tokenized',
        retryToken: 'submission-1',
        maxAttempts: 3,
      })
      expect(JSON.parse(new TextDecoder().decode(request.body))).toEqual({
        buildPipelineId: 'pipeline',
      })
      expect(result.output).toMatchObject({
        accepted: true,
        etag: 'version-1',
        resource: { id: 'run', terminal: false, succeeded: null },
      })
      expect(mocks.request).toHaveBeenCalledOnce()
    }
  )

  it.each([
    ['create_build_pipeline', { projectId: 'project', retryToken: 'stable' }, [201, 202]],
    [
      'create_build_pipeline_stage',
      {
        buildPipelineId: 'pipeline',
        retryToken: 'stable',
        stage: {
          buildPipelineStageType: 'WAIT',
          buildPipelineStagePredecessorCollection: { items: [{ id: 'pipeline' }] },
          waitCriteria: { waitType: 'ABSOLUTE_WAIT', waitDuration: 'PT1S' },
        },
      },
      [201, 202],
    ],
    [
      'update_repository',
      { repositoryId: 'repository', ifMatch: 'etag', description: 'reviewed' },
      [200, 202],
    ],
  ] as const)(
    'preserves documented and live success contracts for %s',
    async (action, input, statuses) => {
      for (const status of statuses) {
        mocks.request.mockResolvedValue(
          response({ id: 'resource', lifecycleState: 'ACTIVE' }, status, {
            etag: 'version-2',
            'opc-work-request-id': 'work',
          })
        )
        expect((await execute(action, input)).output).toMatchObject({
          accepted: true,
          etag: 'version-2',
          workRequestId: 'work',
          resource: { id: 'resource' },
        })
      }
      mocks.request.mockResolvedValue(response({ id: 'resource' }, 204))
      await expect(execute(action, input)).rejects.toMatchObject({ status: 204 })
    }
  )

  it('rejects combined repository scope before creating a client', async () => {
    await expect(
      execute('list_repositories', { compartmentId: 'compartment', projectId: 'project' })
    ).rejects.toMatchObject({ status: 400 })
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it.each([201, 202])(
    'accepts trigger creation HTTP %i with projected metadata',
    async (status) => {
      mocks.request.mockResolvedValue(
        response(
          {
            id: 'trigger',
            projectId: 'project',
            compartmentId: 'compartment',
            triggerSource: 'DEVOPS_CODE_REPOSITORY',
            repositoryId: 'repository',
            actions: [{ type: 'TRIGGER_BUILD_PIPELINE', buildPipelineId: 'pipeline' }],
            lifecycleState: 'ACTIVE',
            webhookSecret: 'private',
          },
          status,
          { etag: '"trigger-version"', 'opc-work-request-id': 'work' }
        )
      )
      const result = await execute('create_trigger', {
        projectId: 'project',
        retryToken: 'stable',
        trigger: {
          triggerSource: 'DEVOPS_CODE_REPOSITORY',
          repositoryId: 'repository',
          actions: [{ type: 'TRIGGER_BUILD_PIPELINE', buildPipelineId: 'pipeline' }],
        },
      })
      expect(result).toMatchObject({
        success: true,
        output: {
          accepted: true,
          requestId: 'request-1',
          etag: '"trigger-version"',
          workRequestId: 'work',
          resource: { id: 'trigger', repositoryId: 'repository', lifecycleState: 'ACTIVE' },
        },
      })
      expect(JSON.stringify(result)).not.toContain('private')
      expect(mocks.request).toHaveBeenCalledOnce()
    }
  )

  it.each([
    { status: 200, body: new TextEncoder().encode('{"id":"trigger"}'), errorStatus: 200 },
    { status: 204, body: new Uint8Array(), errorStatus: 204 },
    { status: 202, body: new Uint8Array(), errorStatus: 502 },
    { status: 202, body: new TextEncoder().encode('{'), errorStatus: 502 },
    { status: 202, body: new TextEncoder().encode('{"id":123}'), errorStatus: 502 },
  ])('rejects invalid trigger creation response %j', async ({ status, body, errorStatus }) => {
    mocks.request.mockResolvedValue({ ...response(null, status), body })
    await expect(
      execute('create_trigger', {
        projectId: 'project',
        retryToken: 'stable',
        trigger: {
          triggerSource: 'DEVOPS_CODE_REPOSITORY',
          repositoryId: 'repository',
          actions: [{ type: 'TRIGGER_BUILD_PIPELINE', buildPipelineId: 'pipeline' }],
        },
      })
    ).rejects.toMatchObject({ status: errorStatus })
    expect(mocks.request).toHaveBeenCalledOnce()
  })

  it('preserves a quoted trigger ETag through a conditional empty-body deletion', async () => {
    const etag = '"trigger-version"'
    mocks.request.mockResolvedValue(response({ id: 'trigger' }, 200, { etag }))
    const read = await execute('get_trigger', { triggerId: 'trigger' })
    mocks.request.mockResolvedValue({ ...response(null, 202), body: new Uint8Array() })
    expect(
      (await execute('delete_trigger', { triggerId: 'trigger', ifMatch: read.output.etag })).success
    ).toBe(true)
    expect(mocks.request.mock.calls[1][0]).toMatchObject({
      method: 'DELETE',
      encodedPath: '/20210630/triggers/trigger',
      headers: { 'if-match': etag },
    })
    expect(mocks.request.mock.calls[1][0].retry).toBeUndefined()
  })

  it('does not reinterpret an original build-run provider 500 as acceptance', async () => {
    mocks.request.mockRejectedValue(
      new OciClientError('request_failed', { status: 500, opcRequestId: 'original-run' })
    )
    await expect(
      execute('create_build_run', { buildPipelineId: 'pipeline', retryToken: 'stable' })
    ).rejects.toMatchObject({ status: 500, opcRequestId: 'original-run' })
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

  it.each([201, 202])(
    'preserves connection creation HTTP %i and Vault references',
    async (status) => {
      mocks.request.mockResolvedValue(
        response({ id: 'connection', accessToken: 'private', lifecycleState: 'ACTIVE' }, status, {
          etag: 'connection-version',
          'opc-work-request-id': 'work',
        })
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
      expect(result.output).toMatchObject({
        accepted: true,
        etag: 'connection-version',
        requestId: 'request-1',
        workRequestId: 'work',
        resource: { id: 'connection', lifecycleState: 'ACTIVE' },
      })
      expect(JSON.stringify(result)).not.toContain('private')
      expect(mocks.request).toHaveBeenCalledOnce()
    }
  )

  it.each([
    { status: 200, body: new TextEncoder().encode('{"id":"connection"}'), errorStatus: 200 },
    { status: 204, body: new Uint8Array(), errorStatus: 204 },
    { status: 202, body: new Uint8Array(), errorStatus: 502 },
    { status: 202, body: new TextEncoder().encode('{'), errorStatus: 502 },
    { status: 202, body: new TextEncoder().encode('{"id":123}'), errorStatus: 502 },
  ])('rejects invalid connection creation response %j', async ({ status, body, errorStatus }) => {
    mocks.request.mockResolvedValue({ ...response(null, status), body })
    await expect(
      execute('create_connection', {
        projectId: 'project',
        retryToken: 'stable',
        connection: {
          connectionType: 'GITHUB_ACCESS_TOKEN',
          secretId: 'ocid1.vaultsecret.oc1..example',
        },
      })
    ).rejects.toMatchObject({ status: errorStatus })
    expect(mocks.request).toHaveBeenCalledOnce()
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
