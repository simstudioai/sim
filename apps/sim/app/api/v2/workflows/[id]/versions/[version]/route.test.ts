/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
  resolveWorkflowContext: vi.fn(),
  readVersion: vi.fn(),
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
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

import { GET } from '@/app/api/v2/workflows/[id]/versions/[version]/route'

const auth = {
  principal: {
    kind: 'personal_api_key' as const,
    userId: 'user-1',
    keyId: 'personal-key-1',
  },
  rolloutUserId: 'user-1',
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

describe('GET /api/v2/workflows/[id]/versions/[version]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.resolveWorkflowContext.mockResolvedValue(workflowContext)
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
    return GET(request, { params: Promise.resolve({ id: 'workflow-1', version: '2' }) })
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
