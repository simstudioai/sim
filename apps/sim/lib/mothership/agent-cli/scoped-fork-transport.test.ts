import { runEmbeddedCli } from 'sim/embed'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  permission: vi.fn(),
  workspace: vi.fn(),
  execute: vi.fn(),
}))
vi.mock('@/lib/api/server/routes/in-process-transport', () => ({
  dispatchInProcessV2Request: mocks.dispatch,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string, required: string) => actual === required,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/permission-groups/capability-assertions', () => ({
  assertWorkspaceCapability: vi.fn(),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ getWorkspaceWithOwner: mocks.workspace }))
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => ({ assertForkingEnabled: vi.fn() }))
vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => ({ resolveForkEdge: vi.fn() }))

import { copilotRequestPrincipal } from '@/lib/api/server/routes/copilot-request'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'
import { defineForkUseCase } from '@/ee/workspace-forking/application/authorized-fork-use-case'
import { forkOperations } from '@/ee/workspace-forking/application/operations'

const workspaceId = '22222222-2222-4222-8222-222222222222'
const otherWorkspaceId = '33333333-3333-4333-8333-333333333333'
const requestId = '44444444-4444-4444-8444-444444444444'
const mutationFlags = ['--request-id', requestId, '--preview-fingerprint', 'a'.repeat(64)]
const endpoint = 'https://sim.test'
const transport = createScopedCliTransport(endpoint, {
  userId: 'actor',
  workspaceId,
  chatId: 'chat',
})

beforeEach(() => {
  mocks.permission.mockResolvedValue('admin')
  mocks.workspace.mockImplementation(async (id: string) => ({
    id,
    organizationId: 'org',
    allowPersonalApiKeys: false,
  }))
})

describe('native fork commands through private Copilot transport', () => {
  it.each([
    {
      argv: ['workspaces', 'fork', ...mutationFlags],
      path: 'fork',
      operation: forkOperations.create,
      bothSides: false,
      method: 'POST',
    },
    {
      argv: [
        'workspaces',
        'push',
        '--other-workspace-id',
        otherWorkspaceId,
        ...mutationFlags,
        '--yes',
      ],
      path: 'fork/push',
      operation: forkOperations.sync,
      bothSides: true,
      method: 'POST',
    },
    {
      argv: [
        'workspaces',
        'pull',
        '--other-workspace-id',
        otherWorkspaceId,
        ...mutationFlags,
        '--yes',
      ],
      path: 'fork/pull',
      operation: forkOperations.sync,
      bothSides: true,
      method: 'POST',
    },

    {
      argv: ['workspaces', 'fork-preview'],
      path: 'fork/preview',
      operation: forkOperations.preview,
      bothSides: false,
      method: 'POST',
    },
    {
      argv: ['workspaces', 'push-preview', '--other-workspace-id', otherWorkspaceId],
      path: 'fork/push/preview',
      operation: forkOperations.syncPreview,
      bothSides: true,
      method: 'POST',
    },
    {
      argv: ['workspaces', 'pull-preview', '--other-workspace-id', otherWorkspaceId],
      path: 'fork/pull/preview',
      operation: forkOperations.syncPreview,
      bothSides: true,
      method: 'POST',
    },
    {
      argv: [
        'workspaces',
        'mappings',
        'get',
        '--other-workspace-id',
        otherWorkspaceId,
        '--direction',
        'push',
      ],
      path: 'fork/mappings',
      operation: forkOperations.mappingsRead,
      bothSides: true,
      method: 'GET',
    },
  ])(
    'dispatches $path with the admitted actor and canonical fork policy',
    async ({ argv, path, operation, bothSides, method }) => {
      const useCase = defineForkUseCase({
        operation,
        bothSides,
        execute: async ({ context }) => {
          mocks.execute(context)
          return {
            operationId: 'synthetic',
            requestId,
            workspaceId,
            kind:
              path === 'fork/push'
                ? 'workspace_push'
                : path === 'fork/pull'
                  ? 'workspace_pull'
                  : 'workspace_fork',
            applied: true,
            status: 'completed',
            resourceIds: [],
            issues: [],
          }
        },
      })
      mocks.dispatch.mockImplementation(async (request: Request) => {
        const url = new URL(request.url)
        expect(url.pathname).toBe(`/api/v2/workspaces/${workspaceId}/${path}`)
        expect(request.method).toBe(method)
        const body = method === 'GET' ? undefined : await request.json()
        const other =
          method === 'GET' ? url.searchParams.get('otherWorkspaceId') : body.otherWorkspaceId
        expect(other ?? undefined).toBe(bothSides ? otherWorkspaceId : undefined)
        const principal = copilotRequestPrincipal(request, operation, useCase)
        if (!principal) throw new Error('Native command lost private admission')
        expect(principal).toMatchObject({
          subjectUserId: 'actor',
          workspaceId,
          resourceScope: { chatId: 'chat' },
        })
        const result = await useCase.execute({
          principal,
          input: { workspaceId, ...(bothSides ? { otherWorkspaceId } : {}) },
        })
        return Response.json(method === 'GET' ? { data: [], nextCursor: null } : { data: result })
      })
      const result = await withWorkspaceInvocationScope(
        { workspaceId, organizationId: 'org' },
        () =>
          runEmbeddedCli(argv, {
            endpoint,
            workspaceId,
            apiKey: 'mothership-in-process',
            transport,
          })
      )
      expect(result.exitCode, result.stderr).toBe(0)
      expect(mocks.dispatch).toHaveBeenCalledTimes(1)
      expect(mocks.permission.mock.calls.map((call) => call.slice(0, 3))).toEqual([
        ['actor', workspaceId, 'org'],
        ...(bothSides ? [['actor', otherWorkspaceId, 'org']] : []),
      ])
      expect(mocks.execute).toHaveBeenCalledTimes(1)
    }
  )

  it('does not widen a workspace-bound request when the URL names another primary target', async () => {
    const operation = forkOperations.preview
    const useCase = defineForkUseCase({ operation, execute: async () => mocks.execute() })
    mocks.dispatch.mockImplementation(async (request: Request) => {
      const principal = copilotRequestPrincipal(request, operation, useCase)
      if (!principal) throw new Error('Missing private admission')
      await useCase.execute({ principal, input: { workspaceId: otherWorkspaceId } })
      return Response.json({ data: {} })
    })
    await expect(
      withWorkspaceInvocationScope({ workspaceId }, () =>
        transport(`${endpoint}/api/v2/workspaces/${otherWorkspaceId}/fork/preview`, {
          method: 'POST',
        })
      )
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
