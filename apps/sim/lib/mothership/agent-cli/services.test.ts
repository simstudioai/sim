/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const boundary = vi.hoisted(() => ({
  workspace: vi.fn(),
  organization: vi.fn(),
  route: vi.fn(),
  sink: vi.fn(),
  provenance: vi.fn(),
  readInput: vi.fn(),
}))
vi.mock('@/lib/mothership/application/workspace-target', () => ({
  resolveInvocationWorkspace: boundary.workspace,
}))
vi.mock('@/lib/mothership/chat/organization-chats', () => ({
  authorizeOrganizationChatDelegation: { execute: boundary.organization },
}))
vi.mock('@/lib/mothership/tools/server/router', () => ({ routeExecution: boundary.route }))
vi.mock('@/lib/mothership/agent-cli/run-cli', () => ({
  readCliInputFile: boundary.readInput,
  runCli: vi.fn(),
}))
vi.mock('@/lib/mothership/agent-cli/sink', () => ({ applySink: boundary.sink }))
vi.mock('@/lib/mothership/agent-cli/workbench-file-provenance', () => ({
  createWorkbenchFileProvenance: boundary.provenance,
}))

import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import { executeAgentCliService } from '@/lib/mothership/agent-cli/services'
import type { AgentCliRequest } from '@/lib/mothership/generated/agent-cli'
import { executeSimCli } from '@/lib/mothership/tools/handlers/sim-cli'

const organization: AgentCliExecutionContext = {
  userId: 'actor',
  organizationId: 'org',
  chatId: 'chat',
  toolCallId: 'call',
  copilotToolExecution: true,
  requestMode: 'agent',
}
const workspace = { ...organization, organizationId: undefined, workspaceId: 'ws' }
function service(
  name: Extract<AgentCliRequest['invocation'], { kind: 'service' }>['name'],
  input = {}
): AgentCliRequest {
  return { invocation: { kind: 'service', name, input } }
}
describe('scoped CLI service adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    boundary.workspace.mockResolvedValue({ workspaceId: 'chosen', userId: 'actor' })
    boundary.organization.mockResolvedValue({ organizationId: 'org' })
    boundary.route.mockResolvedValue({ success: true, documents: [{ citation: '<doc id="1" />' }] })
    boundary.provenance.mockReturnValue({ observeOutput: vi.fn() })
    boundary.sink.mockImplementation(async (_sink, _session, result) => result)
  })
  it('publishes the same Search address through the Agent CLI service', async () => {
    boundary.route.mockResolvedValue({ success: true, data: { query: 'safe policy' } })
    const result = await executeAgentCliService(
      service('search_workspace', { query: 'policy', topK: 4 }),
      organization
    )
    expect(result.resources).toEqual([
      {
        op: 'upsert',
        resource: expect.objectContaining({
          type: 'search',
          id: 'search:organization:org',
          search: expect.objectContaining({ query: 'safe policy', topK: 4 }),
        }),
      },
    ])
  })

  it.each(['list_workspaces', 'search_workspace', 'read_document', 'search_sources'] as const)(
    '%s keeps org chat authority without workspace resolution',
    async (name) => {
      const result = await executeAgentCliService(service(name), organization)
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout).documents[0].citation).toBe('<doc id="1" />')
      expect(boundary.workspace).not.toHaveBeenCalled()
      expect(boundary.organization).toHaveBeenCalledWith({
        principal: expect.objectContaining({
          subjectUserId: 'actor',
          organizationId: 'org',
          resourceScope: { chatId: 'chat' },
        }),
      })
      expect(boundary.route).toHaveBeenCalledWith(
        name,
        {},
        expect.objectContaining({ organizationId: 'org', workspaceId: undefined })
      )
      await expect(executeAgentCliService(service(name), workspace)).rejects.toThrow(
        'organization conversation'
      )
    }
  )
  it('passes trusted execution metadata through the real sim_cli handler and index branch', async () => {
    const signal = new AbortController().signal
    const result = await executeSimCli(
      { request: service('search_workspace', { query: 'hello' }) },
      {
        ...organization,
        workflowId: '',
        requestMode: 'agent',
        searchSurface: 'slack',
        assistantSearch: { connectorIds: ['source'] },
        abortSignal: signal,
      }
    )
    expect(result.success).toBe(true)
    expect(boundary.workspace).not.toHaveBeenCalled()
    expect(boundary.route).toHaveBeenCalledWith(
      'search_workspace',
      { query: 'hello' },
      expect.objectContaining({
        toolCallId: 'call',
        copilotToolExecution: true,
        assistantSearch: { connectorIds: ['source'] },
        searchSurface: 'slack',
        abortSignal: signal,
        userStopSignal: signal,
      })
    )
    boundary.route.mockRejectedValueOnce(new Error('private database failure'))
    const failed = await executeSimCli(
      { request: service('search_workspace') },
      { ...organization, workflowId: '' }
    )
    expect(failed).toMatchObject({
      success: false,
      error: 'The operation failed due to a system error. Please retry.',
    })
  })
  it.each([
    ['list_workspaces', { limit: 0 }, 'limit', '>=1'],
    [
      'settings',
      { scope: 'account', action: 'describe', section: 'profile' },
      'operation',
      'expected string',
    ],
  ] as const)(
    'returns actionable canonical %s input errors through the real router',
    async (name, input, field, constraint) => {
      const { routeExecution } = await vi.importActual<
        typeof import('@/lib/mothership/tools/server/router')
      >('@/lib/mothership/tools/server/router')
      boundary.route.mockImplementationOnce(routeExecution)
      const result = await executeSimCli(
        { request: service(name, input) },
        { ...organization, workflowId: '' }
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain(field)
      expect(result.error).toContain(constraint)
      expect(result.error).not.toContain('system error')
      expect(boundary.sink).not.toHaveBeenCalled()
    }
  )

  it('keeps unexpected handler or output schema failures generic', async () => {
    const invalidOutput = z.object({ internalField: z.string() }).safeParse({})
    if (invalidOutput.success) throw new Error('Expected invalid fixture')
    boundary.route.mockRejectedValueOnce(invalidOutput.error)
    const result = await executeSimCli(
      { request: service('list_workspaces') },
      { ...organization, workflowId: '' }
    )
    expect(result).toMatchObject({
      success: false,
      error: 'The operation failed due to a system error. Please retry.',
    })
  })

  it('retains exact workspace lookup as an org inventory filter without selecting that workspace', async () => {
    await executeAgentCliService(
      service('list_workspaces', { workspaceId: 'lookup' }),
      organization
    )
    expect(boundary.workspace).not.toHaveBeenCalled()
    expect(boundary.route).toHaveBeenCalledWith(
      'list_workspaces',
      { workspaceId: 'lookup' },
      expect.objectContaining({ organizationId: 'org', workspaceId: undefined })
    )
  })
  it('resolves JSON file flags only after chat authority and before canonical handler validation', async () => {
    boundary.readInput.mockResolvedValue(Buffer.from('{"name":"New name"}'))
    const request: AgentCliRequest = {
      invocation: {
        kind: 'service',
        name: 'settings',
        input: { scope: 'account', action: 'update', section: 'profile' },
        inputFiles: { changes: '/tmp/changes.json' },
      },
    }
    await executeAgentCliService(request, organization)
    expect(boundary.organization.mock.invocationCallOrder[0]).toBeLessThan(
      boundary.readInput.mock.invocationCallOrder[0]
    )
    expect(boundary.readInput).toHaveBeenCalledWith(
      'mothership-chat:chat',
      '/tmp/changes.json',
      undefined
    )
    expect(boundary.route).toHaveBeenCalledWith(
      'settings',
      { scope: 'account', action: 'update', section: 'profile', changes: { name: 'New name' } },
      expect.anything()
    )
    boundary.organization.mockRejectedValueOnce(new Error('Chat revoked'))
    await expect(executeAgentCliService(request, organization)).rejects.toThrow('Chat revoked')
    expect(boundary.readInput).toHaveBeenCalledTimes(1)
  })
  it('rejects file flags that replace scope or collide with inline JSON and reports invalid JSON safely', async () => {
    for (const invocation of [
      {
        kind: 'service',
        name: 'settings',
        input: { scope: 'account', action: 'update', section: 'profile' },
        inputFiles: { scope: '/tmp/scope.json' },
      },
      {
        kind: 'service',
        name: 'settings',
        input: { scope: 'account', action: 'update', section: 'profile', changes: {} },
        inputFiles: { changes: '/tmp/changes.json' },
      },
    ] as const)
      await expect(
        executeAgentCliService({ invocation } as unknown as AgentCliRequest, organization)
      ).rejects.toThrow('supported, omitted JSON flag')
    expect(boundary.readInput).not.toHaveBeenCalled()
    boundary.readInput.mockResolvedValue(Buffer.from('broken json'))
    await expect(
      executeAgentCliService(
        {
          invocation: {
            kind: 'service',
            name: 'settings',
            input: { scope: 'account', action: 'update', section: 'profile' },
            inputFiles: { changes: '/tmp/changes.json' },
          },
        },
        organization
      )
    ).rejects.toThrow('not valid JSON')
    expect(boundary.route).not.toHaveBeenCalled()
  })
  it('rejects forged workspace selectors and alternate service input targets', async () => {
    await expect(
      executeAgentCliService(
        { ...service('settings', { scope: 'account', action: 'list' }), workspaceId: 'other' },
        organization
      )
    ).rejects.toThrow('do not take')
    await expect(
      executeAgentCliService(
        service('settings', { scope: 'workspace', workspaceId: 'other' }),
        organization
      )
    ).rejects.toThrow('invocation workspace target')
    expect(boundary.route).not.toHaveBeenCalled()
  })
  it('rechecks workspace settings against original org and passes selected workspace context', async () => {
    await executeAgentCliService(
      { ...service('settings', { scope: 'workspace', action: 'list' }), workspaceId: 'chosen' },
      organization
    )
    expect(boundary.workspace).toHaveBeenCalledWith(organization, 'chosen')
    expect(boundary.route).toHaveBeenCalledWith(
      'settings',
      { scope: 'workspace', action: 'list' },
      expect.objectContaining({
        workspaceId: 'chosen',
        organizationId: undefined,
        chatOrganizationId: 'org',
      })
    )
    expect(boundary.provenance).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org',
        workspaceId: 'chosen',
        sessionKey: 'mothership-chat:chat',
      })
    )
    boundary.workspace.mockRejectedValueOnce(new Error('Access revoked'))
    await expect(
      executeAgentCliService(
        { ...service('settings', { scope: 'workspace' }), workspaceId: 'chosen' },
        organization
      )
    ).rejects.toThrow('Access revoked')
    expect(boundary.route).toHaveBeenCalledTimes(1)
  })
  it('supports account settings in workspace chat without org promotion', async () => {
    await executeAgentCliService(
      service('settings', { scope: 'account', action: 'list' }),
      workspace
    )
    expect(boundary.workspace).toHaveBeenCalledWith(workspace)
    expect(boundary.route).toHaveBeenCalledWith(
      'settings',
      { scope: 'account', action: 'list' },
      expect.objectContaining({ workspaceId: 'ws', organizationId: undefined })
    )
    await expect(
      executeAgentCliService(
        service('settings', { scope: 'organization', action: 'list' }),
        workspace
      )
    ).rejects.toThrow('organization conversation')
  })
  it.each([
    { requestMode: 'assistant' },
    { copilotToolExecution: false },
    { chatId: undefined },
    { toolCallId: undefined },
  ])('refuses untrusted or assistant context %j', async (override) => {
    await expect(
      executeAgentCliService(service('list_workspaces'), { ...organization, ...override })
    ).rejects.toThrow()
    expect(boundary.route).not.toHaveBeenCalled()
  })
  it('preserves trusted search context and cancellation', async () => {
    const controller = new AbortController()
    const context = { ...organization, signal: controller.signal, searchSurface: 'slack' as const }
    await executeAgentCliService(service('search_workspace', { query: 'request' }), context)
    expect(boundary.route).toHaveBeenCalledWith(
      'search_workspace',
      { query: 'request' },
      expect.objectContaining({
        searchSurface: 'slack',
        abortSignal: controller.signal,
        userStopSignal: controller.signal,
      })
    )
    controller.abort()
    await expect(executeAgentCliService(service('search_workspace'), context)).rejects.toThrow()
    expect(boundary.route).toHaveBeenCalledTimes(1)
  })
  it('projects a domain failure to nonzero while preserving structured output', async () => {
    boundary.route.mockResolvedValue({
      success: false,
      message: 'Source unavailable',
      retryable: true,
    })
    expect(await executeAgentCliService(service('read_document'), organization)).toEqual({
      exitCode: 1,
      stderr: 'Source unavailable',
      stdout: JSON.stringify({ success: false, message: 'Source unavailable', retryable: true }),
    })
  })
  it('authorizes no-workspace stdout before its org chat sandbox sink', async () => {
    const request: AgentCliRequest = {
      invocation: { kind: 'stdout', stdout: 'saved reference' },
      sink: { kind: 'sandbox-file', path: '/tmp/reference.json' },
    }
    await executeAgentCliService(request, organization)
    expect(boundary.workspace).not.toHaveBeenCalled()
    expect(boundary.route).not.toHaveBeenCalled()
    expect(boundary.provenance).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org',
        workspaceId: undefined,
        sessionKey: 'mothership-chat:chat',
      })
    )
    expect(boundary.sink).toHaveBeenCalledWith(
      request.sink,
      'mothership-chat:chat',
      { exitCode: 0, stdout: 'saved reference', stderr: '' },
      undefined,
      expect.any(Function)
    )
    boundary.organization.mockRejectedValueOnce(new Error('Conversation not found'))
    await expect(executeAgentCliService(request, organization)).rejects.toThrow(
      'Conversation not found'
    )
    expect(boundary.sink).toHaveBeenCalledTimes(1)
  })
})
