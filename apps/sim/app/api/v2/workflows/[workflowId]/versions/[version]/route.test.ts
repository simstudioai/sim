import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import {
  searchReplaceIndexerMock,
  searchReplaceIndexerMockFns,
} from '@sim/testing/mocks/search-replace-indexer.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import { workflowsOrchestrationMock } from '@sim/testing/mocks/workflows-orchestration.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workflows/application/context', () => workflowContextMock)
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)
vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)
vi.mock('@/lib/workflows/search-replace/indexer', () => searchReplaceIndexerMock)
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { GET, PATCH } from '@/app/api/v2/workflows/[workflowId]/versions/[version]/route'
import { getBlock } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'

searchReplaceIndexerMockFns.mockGetToolInputParamConfigs.mockImplementation(
  ({ tool }: { tool: { type: string; params?: Record<string, unknown> } }) =>
    Object.entries(tool.params ?? {}).map(([paramId, value]) => ({
      paramId,
      authoritative: tool.type !== 'custom-tool' && tool.type !== 'mcp',
      value,
      config: {
        id: paramId,
        type: 'short-input',
        password: paramId === 'apiKey',
      },
    }))
)

vi.mocked(getBlock).mockReturnValue({
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
} as BlockConfig)

const auth = {
  principal: createPersonalApiKeyPrincipal({ keyId: 'personal-key-1' }),
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
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')
    workflowContextMockFns.mockResolveActiveWorkflowApplicationContext.mockResolvedValue(
      workflowContext
    )
    workflowsPersistenceUtilsMockFns.mockUpdateDeploymentVersionMetadata.mockResolvedValue({
      name: 'Production',
      description: null,
    })
    workflowsPersistenceUtilsMockFns.mockGetWorkflowDeploymentVersion.mockResolvedValue({
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
    const request = createMockRequest({
      url: 'http://localhost/api/v2/workflows/workflow-1/versions/2',
    })
    return GET(request, createRouteContext({ workflowId: 'workflow-1', version: '2' }))
  }

  it('reads the requested version only after canonical workflow authorization', async () => {
    const response = await get()

    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ id: 'version-2', version: 2 })
    expect(
      workflowContextMockFns.mockResolveActiveWorkflowApplicationContext
    ).toHaveBeenCalledBefore(workflowsPersistenceUtilsMockFns.mockGetWorkflowDeploymentVersion)
    expect(workflowsPersistenceUtilsMockFns.mockGetWorkflowDeploymentVersion).toHaveBeenCalledWith(
      'workflow-1',
      2
    )
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
})

describe('PATCH /api/v2/workflows/[workflowId]/versions/[version]', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
    workflowContextMockFns.mockResolveActiveWorkflowApplicationContext.mockResolvedValue(
      workflowContext
    )
    workflowsPersistenceUtilsMockFns.mockUpdateDeploymentVersionMetadata.mockResolvedValue({
      name: 'Escalation routing',
      description: 'Adds the escalation branch.',
    })
  })

  async function patch(body: unknown) {
    const request = createMockRequest({
      method: 'PATCH',
      url: 'http://localhost/api/v2/workflows/workflow-1/versions/2',
      body,
    })
    return PATCH(request, createRouteContext({ workflowId: 'workflow-1', version: '2' }))
  }

  it('clears the release note on an explicit null and leaves an omitted label alone', async () => {
    workflowsPersistenceUtilsMockFns.mockUpdateDeploymentVersionMetadata.mockResolvedValue({
      name: 'Production',
      description: null,
    })

    const response = await patch({ description: null })

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({
      version: 2,
      name: 'Production',
      description: null,
    })
    expect(
      workflowsPersistenceUtilsMockFns.mockUpdateDeploymentVersionMetadata
    ).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      version: 2,
      name: undefined,
      description: null,
    })
  })

  it('answers 404 for a version that does not exist', async () => {
    workflowsPersistenceUtilsMockFns.mockUpdateDeploymentVersionMetadata.mockResolvedValue(null)

    const response = await patch({ name: 'Escalation routing' })

    expect(response.status).toBe(404)
    expect((await response.json()).error.message).toBe('Deployment version not found')
  })

  it('refuses a caller below workspace write with 403', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')

    const response = await patch({ name: 'Escalation routing' })

    expect(response.status).toBe(403)
    expect((await response.json()).error.details.code).toBe('INSUFFICIENT_WORKSPACE_ROLE')
    expect(
      workflowsPersistenceUtilsMockFns.mockUpdateDeploymentVersionMetadata
    ).not.toHaveBeenCalled()
  })

  it('conceals a workflow the caller cannot reach as 404', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)

    const response = await patch({ name: 'Escalation routing' })

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
    expect(
      workflowsPersistenceUtilsMockFns.mockUpdateDeploymentVersionMetadata
    ).not.toHaveBeenCalled()
  })
})
