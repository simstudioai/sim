import { mcpUseCasesMock } from '@sim/testing/mocks/mcp-use-cases.mock'
import {
  mothershipChatPayloadMock,
  mothershipChatPayloadMockFns,
} from '@sim/testing/mocks/mothership-chat-payload.mock'
import { mothershipChatWorkspaceContextMock } from '@sim/testing/mocks/mothership-chat-workspace-context.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/lib/mothership/request/http')
vi.mock('@/lib/mothership/chat/payload', () => mothershipChatPayloadMock)
vi.mock('@/lib/mothership/mcp-tools', () => ({ buildTaggedMcpToolSchemas: vi.fn() }))
vi.mock('@/lib/mcp/application/use-cases', () => mcpUseCasesMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock(
  '@/lib/mothership/chat/application/workspace-context',
  () => mothershipChatWorkspaceContextMock
)
vi.mock('@/lib/mothership/request/application/read-control', () => ({
  RUN_CONTROL_AUDIENCE: 'control',
  readRunControl: { execute: vi.fn() },
}))
vi.mock('@/lib/mothership/tasks/application/read-workflow-status', () => ({
  readWatchedWorkflowStatus: { execute: vi.fn() },
}))
vi.mock('@/lib/mothership/tasks/application/prepare-wake', () => ({
  prepareTaskWake: { execute: vi.fn() },
}))
vi.mock('@/lib/mothership/tasks/application/context', () => ({ TASK_DELEGATION_AUDIENCE: 'tasks' }))
vi.mock('@/lib/mothership/tasks/wake', () => ({ runWakeTurn: vi.fn() }))

import { env } from '@/lib/core/config/env'
import type { IntegrationCatalogRequest } from '@/lib/mothership/generated/integration-catalog'
import { executeSimControl } from '@/lib/mothership/transport/control'
import { POST } from '@/app/api/mothership/integrations/catalog/route'

const mocks = {
  build: mothershipChatPayloadMockFns.mockBuildIntegrationToolSchemas,
  workspace: workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const scope = {
  userId: 'actor',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  chatId: '33333333-3333-4333-8333-333333333333',
}
const input = { mode: 'agent' as const, mcpServerIds: [], toolId: 'gmail_send', limit: 1 }
function request(
  key = env.INTERNAL_API_SECRET ?? '',
  catalogInput: IntegrationCatalogRequest = input
) {
  return createMockRequest({
    method: 'POST',
    url: 'http://localhost/api/mothership/integrations/catalog',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'x-mothership-user-id': scope.userId,
      'x-mothership-workspace-id': scope.workspaceId,
      'x-mothership-chat-id': scope.chatId,
    },
    body: catalogInput,
  })
}
function checkpoint(catalogInput: IntegrationCatalogRequest = input) {
  return executeSimControl({
    id: 'catalog-control',
    scope,
    expiresAt: Date.now() + 5000,
    operation: { kind: 'integration_catalog', input: catalogInput },
  })
}
beforeEach(() => {
  mocks.permission.mockResolvedValue('read')
  mocks.workspace.mockResolvedValue({
    workspaceId: scope.workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
  })
  mocks.build.mockResolvedValue([
    {
      name: 'gmail_send',
      description: 'Send email',
      service: 'gmail',
      input_schema: { type: 'object' },
    },
  ])
})
describe('direct and checkpoint catalog authorization parity', () => {
  it.each(['google-email', 'Gmail', 'gmail'])(
    'resolves %s identically through hosted HTTP and self-hosted outbound control',
    async (service) => {
      const query = { mode: 'agent' as const, mcpServerIds: [], service, query: 'email', limit: 5 }
      const direct = await POST(request(undefined, query))
      const outbound = await checkpoint(query)
      expect(direct.status).toBe(200)
      expect(outbound.status).toBe(200)
      const body = await direct.json()
      expect(body).toEqual(JSON.parse(outbound.body))
      expect(body.operations).toEqual([
        {
          toolId: 'gmail_send',
          service: 'gmail',
          description: 'Send email',
          inputSchema: { type: 'object' },
        },
      ])
    }
  )

  it('reports an invalid service filter as a validation error on both transports', async () => {
    const query = { ...input, service: 'not-a-service' }
    const direct = await POST(request(undefined, query))
    const outbound = await checkpoint(query)
    expect(direct.status).toBe(400)
    expect(outbound.status).toBe(400)
    expect(JSON.stringify(await direct.json())).toContain('Unknown integration service')
    expect(outbound.body).toContain('Unknown integration service')
  })
  it('rejects revoked workspace membership on both transports before catalog loading', async () => {
    mocks.permission.mockResolvedValue(null)
    expect((await POST(request())).status).toBe(403)
    expect((await checkpoint()).status).toBe(403)
    expect(mocks.build).not.toHaveBeenCalled()
  })
  it('rejects untrusted HTTP keys before canonical context loading', async () => {
    expect((await POST(request('browser-key'))).status).toBe(401)
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.build).not.toHaveBeenCalled()
  })
})
