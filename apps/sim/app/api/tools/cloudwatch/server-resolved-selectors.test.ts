/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  resolveContext: vi.fn(),
  hybridAuth: vi.fn(),
  createClient: vi.fn(),
  destroyClient: vi.fn(),
  describeLogGroups: vi.fn(),
  describeLogStreams: vi.fn(),
}))

vi.mock('@/lib/selectors/server/resolve-authorized-context', () => ({
  authenticateSelectorRequest: mocks.authenticate,
  resolveAuthorizedSelectorContext: mocks.resolveContext,
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mocks.hybridAuth,
}))

vi.mock('@/app/api/tools/cloudwatch/utils', () => ({
  createCloudWatchLogsClient: mocks.createClient,
  describeLogGroups: mocks.describeLogGroups,
  describeLogStreams: mocks.describeLogStreams,
}))

import { POST as runtimeLogGroups } from '@/app/api/tools/cloudwatch/describe-log-groups/route'
import { POST as selectorLogGroups } from '@/app/api/tools/cloudwatch/selector-log-groups/route'
import { POST as selectorLogStreams } from '@/app/api/tools/cloudwatch/selector-log-streams/route'

function request(path: string, body: unknown) {
  return createMockRequest('POST', body, {}, `http://localhost:3000${path}`)
}

const wireBody = {
  workflowId: 'workflow-1',
  accessKeyId: '{{AWS_ACCESS_KEY_ID}}',
  secretAccessKey: '{{AWS_SECRET_ACCESS_KEY}}',
  region: '{{AWS_REGION}}',
}

describe('server-resolved CloudWatch selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue({
      ok: true,
      principal: { kind: 'session', userId: 'viewer-1', sessionId: 'session-1' },
    })
    mocks.hybridAuth.mockResolvedValue({ success: true, userId: 'viewer-1' })
    mocks.resolveContext.mockResolvedValue({
      ok: true,
      context: {
        accessKeyId: 'AKIARESOLVED',
        secretAccessKey: 'resolved-secret',
        region: 'us-east-1',
      },
      requesterUserId: 'viewer-1',
      workspaceId: 'workspace-1',
    })
    mocks.createClient.mockReturnValue({ destroy: mocks.destroyClient })
    mocks.describeLogGroups.mockResolvedValue({
      logGroups: [
        {
          logGroupName: '/aws/lambda/example',
          arn: 'arn:aws:logs:example',
          storedBytes: 42,
        },
      ],
    })
    mocks.describeLogStreams.mockResolvedValue({
      logStreams: [
        {
          logStreamName: '2026/08/26/stream',
          storedBytes: 42,
          creationTime: 123,
        },
      ],
    })
  })

  it('authenticates before parsing malformed requests', async () => {
    mocks.authenticate.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const response = await selectorLogGroups(
      request('/api/tools/cloudwatch/selector-log-groups', {})
    )

    expect(response.status).toBe(401)
    expect(mocks.resolveContext).not.toHaveBeenCalled()
  })

  it('short-circuits inaccessible references before creating a provider client', async () => {
    mocks.resolveContext.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'Unable to resolve selector configuration',
    })

    const response = await selectorLogGroups(
      request('/api/tools/cloudwatch/selector-log-groups', wireBody)
    )

    expect(response.status).toBe(400)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('validates resolved credentials, exposes names only, and destroys the client', async () => {
    const response = await selectorLogGroups(
      request('/api/tools/cloudwatch/selector-log-groups', wireBody)
    )

    expect(await response.json()).toEqual({
      logGroups: [{ logGroupName: '/aws/lambda/example' }],
    })
    expect(mocks.resolveContext).toHaveBeenCalledWith(expect.anything(), {
      workflowId: 'workflow-1',
      context: {
        accessKeyId: '{{AWS_ACCESS_KEY_ID}}',
        secretAccessKey: '{{AWS_SECRET_ACCESS_KEY}}',
        region: '{{AWS_REGION}}',
      },
    })
    expect(mocks.createClient).toHaveBeenCalledWith({
      accessKeyId: 'AKIARESOLVED',
      secretAccessKey: 'resolved-secret',
      region: 'us-east-1',
    })
    expect(mocks.destroyClient).toHaveBeenCalledOnce()
  })

  it('maps log streams to strict name-only responses', async () => {
    const response = await selectorLogStreams(
      request('/api/tools/cloudwatch/selector-log-streams', {
        ...wireBody,
        logGroupName: '/aws/lambda/example',
      })
    )

    expect(await response.json()).toEqual({
      logStreams: [{ logStreamName: '2026/08/26/stream' }],
    })
    expect(mocks.describeLogStreams).toHaveBeenCalledWith(
      expect.anything(),
      '/aws/lambda/example',
      { prefix: undefined, limit: undefined }
    )
    expect(mocks.destroyClient).toHaveBeenCalledOnce()
  })

  it('rejects an invalid resolved region before provider access', async () => {
    mocks.resolveContext.mockResolvedValue({
      ok: true,
      context: {
        accessKeyId: 'AKIARESOLVED',
        secretAccessKey: 'resolved-secret',
        region: 'invalid-region',
      },
      requesterUserId: 'viewer-1',
      workspaceId: 'workspace-1',
    })

    const response = await selectorLogGroups(
      request('/api/tools/cloudwatch/selector-log-groups', wireBody)
    )

    expect(response.status).toBe(400)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('retains runtime-route metadata compatibility', async () => {
    const response = await runtimeLogGroups(
      request('/api/tools/cloudwatch/describe-log-groups', {
        accessKeyId: 'AKIA-LITERAL',
        secretAccessKey: 'literal-secret',
        region: 'us-east-1',
      })
    )

    expect(await response.json()).toEqual({
      success: true,
      output: {
        logGroups: [
          {
            logGroupName: '/aws/lambda/example',
            arn: 'arn:aws:logs:example',
            storedBytes: 42,
          },
        ],
      },
    })
  })
})
