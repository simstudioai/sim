/** @vitest-environment node */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ build: vi.fn(), workspace: vi.fn(), permission: vi.fn() }))
vi.unmock('@/lib/mothership/request/http')
vi.mock('@/lib/mothership/chat/payload', () => ({ buildIntegrationToolSchemas: mocks.build }))
vi.mock('@/lib/mothership/mcp-tools', () => ({ buildTaggedMcpToolSchemas: vi.fn() }))
vi.mock('@/lib/mcp/application/use-cases', () => ({ listMcpServersUseCase: { execute: vi.fn() } }))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.workspace,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  resolveEffectiveWorkspacePermission: mocks.permission,
  permissionSatisfies: (actual: string | null, needed: string) =>
    actual === 'admin' || actual === 'write' || actual === needed,
}))
vi.mock('@/lib/mothership/chat/application/workspace-context', () => ({
  readWorkspaceContext: { execute: vi.fn() },
}))
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
import { executeSimControl } from '@/lib/mothership/transport/control'
import { POST } from '@/app/api/mothership/integrations/catalog/route'

const scope = {
  userId: 'actor',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  chatId: '33333333-3333-4333-8333-333333333333',
}
const input = { mode: 'agent' as const, mcpServerIds: [], toolId: 'gmail_send', limit: 1 }
function request(key = env.INTERNAL_API_SECRET ?? '') {
  return new NextRequest('http://localhost/api/mothership/integrations/catalog', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'x-mothership-user-id': scope.userId,
      'x-mothership-workspace-id': scope.workspaceId,
      'x-mothership-chat-id': scope.chatId,
    },
    body: JSON.stringify(input),
  })
}
function checkpoint() {
  return executeSimControl({
    id: 'catalog-control',
    scope,
    expiresAt: Date.now() + 5000,
    operation: { kind: 'integration_catalog', input },
  })
}
beforeEach(() => {
  vi.clearAllMocks()
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
  it('returns identical authorized schema responses through HTTP and outbound control', async () => {
    const direct = await POST(request())
    const outbound = await checkpoint()
    expect(direct.status).toBe(200)
    expect(outbound.status).toBe(200)
    expect(await direct.json()).toEqual(JSON.parse(outbound.body))
    expect(mocks.permission).toHaveBeenCalledTimes(2)
    expect(mocks.build).toHaveBeenCalledTimes(2)
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
