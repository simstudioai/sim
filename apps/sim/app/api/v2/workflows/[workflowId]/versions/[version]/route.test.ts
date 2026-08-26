/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
  resolveWorkflowContext: vi.fn(),
  readVersion: vi.fn(),
  updateVersionMetadata: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveWorkflowContext,
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  getWorkflowDeploymentVersion: mocks.readVersion,
  findPreviousDeploymentVersion: vi.fn(),
  updateDeploymentVersionMetadata: mocks.updateVersionMetadata,
}))
vi.mock('@/lib/workflows/orchestration', () => ({
  getWorkflowDeploymentSummary: vi.fn(),
  performActivateVersion: vi.fn(),
  performFullDeploy: vi.fn(),
  performFullUndeploy: vi.fn(),
  performRevertToVersion: vi.fn(),
}))
vi.mock('@/lib/workflows/search-replace/indexer', () => ({
  getToolInputParamConfigs: ({
    tool,
  }: {
    tool: { type: string; params?: Record<string, unknown> }
  }) =>
    Object.entries(tool.params ?? {}).map(([paramId, value]) => ({
      paramId,
      authoritative: tool.type !== 'custom-tool' && tool.type !== 'mcp',
      value,
      config: {
        id: paramId,
        type: 'short-input',
        password: paramId === 'apiKey',
      },
    })),
}))
vi.mock('@/blocks/registry', () => ({
  getBlock: () => ({
    name: 'Slack',
    subBlocks: [
      { id: 'credential', type: 'oauth-input' },
      { id: 'botToken', type: 'short-input', password: true },
      { id: 'envToken', type: 'short-input', password: true },
      { id: 'tools', type: 'tool-input' },
      { id: 'headers', type: 'table' },
      { id: 'channel', type: 'short-input' },
    ],
    outputs: {},
  }),
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { GET, PATCH } from '@/app/api/v2/workflows/[workflowId]/versions/[version]/route'

const auth = {
  principal: {
    kind: 'personal_api_key' as const,
    userId: 'user-1',
    keyId: 'personal-key-1',
  },
  rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

const workflowContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
  workflowId: 'workflow-1',
  workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
}

function versionState() {
  return {
    blocks: {
      'block-1': {
        id: 'block-1',
        type: 'slack',
        name: 'Slack',
        subBlocks: {
          credential: { id: 'credential', type: 'oauth-input', value: 'oauth-credential-id' },
          botToken: { id: 'botToken', type: 'short-input', value: 'xoxb-plaintext-secret' },
          envToken: { id: 'envToken', type: 'short-input', value: '{{SLACK_BOT_TOKEN}}' },
          tools: {
            id: 'tools',
            type: 'tool-input',
            value: [
              {
                type: 'custom-tool',
                params: { apiKey: 'sk-tool-plaintext-secret', query: 'safe input' },
              },
            ],
          },
          headers: {
            id: 'headers',
            type: 'table',
            value: [{ Key: 'Authorization', Value: 'Bearer table-plaintext-secret' }],
          },
          channel: { id: 'channel', type: 'short-input', value: '#general' },
        },
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    version: '1.0',
  }
}

describe('GET /api/v2/workflows/[workflowId]/versions/[version]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.resolveWorkflowContext.mockResolvedValue(workflowContext)
    mocks.updateVersionMetadata.mockResolvedValue({ name: 'Production', description: null })
    mocks.readVersion.mockResolvedValue({
      id: 'version-2',
      version: 2,
      name: 'Production',
      description: null,
      isActive: true,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      state: versionState(),
    })
  })

  async function get() {
    const request = new NextRequest('http://localhost/api/v2/workflows/workflow-1/versions/2')
    return GET(request, { params: Promise.resolve({ workflowId: 'workflow-1', version: '2' }) })
  }

  it('reads the requested version only after canonical workflow authorization', async () => {
    const response = await get()

    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ id: 'version-2', version: 2 })
    expect(mocks.resolveWorkflowContext).toHaveBeenCalledBefore(mocks.readVersion)
    expect(mocks.readVersion).toHaveBeenCalledWith('workflow-1', 2)
  })

  it('never serves credential values in the pinned graph', async () => {
    const response = await get()

    expect(response.status).toBe(200)
    const subBlocks = (await response.json()).data.state.blocks['block-1'].subBlocks
    expect(subBlocks.credential.value).toBeNull()
    expect(subBlocks.botToken.value).toBeNull()
    expect(subBlocks.envToken.value).toBe('{{SLACK_BOT_TOKEN}}')
    expect(subBlocks.tools.value).toEqual([
      {
        type: 'custom-tool',
        params: { apiKey: null, query: null },
      },
    ])
    expect(subBlocks.headers.value).toBeNull()
    expect(subBlocks.channel.value).toBe('#general')
    expect(JSON.stringify(subBlocks)).not.toContain('sk-tool-plaintext-secret')
    expect(JSON.stringify(subBlocks)).not.toContain('table-plaintext-secret')
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await get()

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})

describe('PATCH /api/v2/workflows/[workflowId]/versions/[version]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveWorkflowContext.mockResolvedValue(workflowContext)
    mocks.updateVersionMetadata.mockResolvedValue({
      name: 'Escalation routing',
      description: 'Adds the escalation branch.',
    })
  })

  async function patch(body: unknown) {
    const request = new NextRequest('http://localhost/api/v2/workflows/workflow-1/versions/2', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return PATCH(request, { params: Promise.resolve({ workflowId: 'workflow-1', version: '2' }) })
  }

  it('writes metadata only after canonical workflow authorization', async () => {
    const response = await patch({
      name: 'Escalation routing',
      description: 'Adds the escalation branch.',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        version: 2,
        name: 'Escalation routing',
        description: 'Adds the escalation branch.',
      },
    })
    expect(mocks.resolveWorkflowContext).toHaveBeenCalledBefore(mocks.updateVersionMetadata)
    expect(mocks.updateVersionMetadata).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      version: 2,
      name: 'Escalation routing',
      description: 'Adds the escalation branch.',
    })
  })

  it('clears the release note on an explicit null and leaves an omitted label alone', async () => {
    mocks.updateVersionMetadata.mockResolvedValue({ name: 'Production', description: null })

    const response = await patch({ description: null })

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({
      version: 2,
      name: 'Production',
      description: null,
    })
    expect(mocks.updateVersionMetadata).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      version: 2,
      name: undefined,
      description: null,
    })
  })

  it('rejects a body that would change nothing', async () => {
    const response = await patch({})

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(JSON.stringify(body.error)).toContain(
      'At least one of name or description must be provided'
    )
    expect(mocks.updateVersionMetadata).not.toHaveBeenCalled()
  })

  it('rejects the activation body shape rather than silently relabelling', async () => {
    const response = await patch({ isActive: true })

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('BAD_REQUEST')
    expect(mocks.updateVersionMetadata).not.toHaveBeenCalled()
  })

  it('answers 404 for a version that does not exist', async () => {
    mocks.updateVersionMetadata.mockResolvedValue(null)

    const response = await patch({ name: 'Escalation routing' })

    expect(response.status).toBe(404)
    expect((await response.json()).error.message).toBe('Deployment version not found')
  })

  it('refuses a caller below workspace write with 403', async () => {
    mocks.resolvePermission.mockResolvedValue('read')

    const response = await patch({ name: 'Escalation routing' })

    expect(response.status).toBe(403)
    expect((await response.json()).error.details.code).toBe('INSUFFICIENT_WORKSPACE_ROLE')
    expect(mocks.updateVersionMetadata).not.toHaveBeenCalled()
  })

  it('conceals a workflow the caller cannot reach as 404', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    const response = await patch({ name: 'Escalation routing' })

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
    expect(mocks.updateVersionMetadata).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await patch({ name: 'Escalation routing' })

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})
