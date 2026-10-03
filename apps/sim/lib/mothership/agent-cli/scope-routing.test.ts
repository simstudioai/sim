import {
  mothershipOrganizationChatsMock,
  mothershipOrganizationChatsMockFns,
} from '@sim/testing/mocks/mothership-organization-chats.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({
  target: vi.fn(),
  route: vi.fn(),
  sink: vi.fn(),
}))
vi.mock('@/lib/mothership/chat/application/workspace-target', () => ({
  WORKSPACE_TARGET_AUDIENCE: 'sim:workspaces',
  authorizeChatWorkspaceTarget: { execute: boundary.target },
}))
vi.mock('@/lib/mothership/chat/organization-chats', () => mothershipOrganizationChatsMock)
vi.mock('@/lib/mothership/tools/server/router', () => ({ routeExecution: boundary.route }))
vi.mock('@/lib/mothership/agent-cli/workbench-file-provenance', () => ({
  createWorkbenchFileProvenance: () => ({ observeOutput: vi.fn() }),
}))
vi.mock('@/lib/mothership/agent-cli/sink', () => ({ applySink: boundary.sink }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { AgentCliRequest } from '@/lib/mothership/generated/agent-cli'
import type { ToolExecutionContext } from '@/lib/mothership/tool-executor/types'
import { executeSimCli } from '@/lib/mothership/tools/handlers/sim-cli'

const mockAuthorizeOrganizationChatDelegation =
  mothershipOrganizationChatsMockFns.mockAuthorizeOrganizationChatDelegation

const selected = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
const organization: ToolExecutionContext = {
  userId: 'actor',
  organizationId: 'org',
  chatId: 'owned-chat',
  toolCallId: 'call',
  copilotToolExecution: true,
  requestMode: 'agent',
  workflowId: '',
}
const workspace = { ...organization, organizationId: undefined, workspaceId: selected }
const stdout: AgentCliRequest = { invocation: { kind: 'stdout', stdout: '' } }

describe('worker-local CLI authorization through the real handler and scope resolver', () => {
  beforeEach(() => {
    boundary.target.mockResolvedValue({
      workspaceId: selected,
      userId: 'actor',
      permission: 'read',
    })
    mockAuthorizeOrganizationChatDelegation.mockResolvedValue({ organizationId: 'org' })
    boundary.sink.mockImplementation(async (_sink, _session, result) => result)
  })

  it.each([
    organization,
    { ...organization, organizationId: undefined, chatOrganizationId: 'org', workspaceId: other },
  ])(
    'authorizes the explicit target with original org authority rather than a prior target',
    async (context) => {
      const result = await executeSimCli({ request: { ...stdout, workspaceId: selected } }, context)
      expect(result).toEqual({ success: true, output: { exitCode: 0, stdout: '', stderr: '' } })
      expect(boundary.target).toHaveBeenCalledWith({
        principal: expect.objectContaining({
          kind: 'organization_delegated',
          subjectUserId: 'actor',
          organizationId: 'org',
          audience: 'sim:workspaces',
          resourceScope: { chatId: 'owned-chat' },
        }),
        input: { chatId: 'owned-chat', workspaceId: selected },
      })
      expect(mockAuthorizeOrganizationChatDelegation).not.toHaveBeenCalled()
      expect(boundary.route).not.toHaveBeenCalled()
    }
  )

  it('retains organization-only authorization for local output without a workspace target', async () => {
    const result = await executeSimCli({ request: stdout }, organization)
    expect(result.success).toBe(true)
    expect(mockAuthorizeOrganizationChatDelegation).toHaveBeenCalledWith({
      principal: expect.objectContaining({ organizationId: 'org', subjectUserId: 'actor' }),
    })
    expect(boundary.target).not.toHaveBeenCalled()
  })

  it('keeps workspace chats fixed and authorizes a targetless local request in that scope', async () => {
    expect((await executeSimCli({ request: stdout }, workspace)).success).toBe(true)
    expect(boundary.target).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        kind: 'delegated',
        workspaceId: selected,
        subjectUserId: 'actor',
      }),
      input: { chatId: 'owned-chat', workspaceId: selected },
    })
    const failed = await executeSimCli({ request: { ...stdout, workspaceId: other } }, workspace)
    expect(failed).toEqual({ success: false, error: 'Workspace not found in this conversation' })
    expect(boundary.target).toHaveBeenCalledTimes(1)
  })

  it.each(['inaccessible', 'unknown'])(
    'preserves canonical concealment for %s target before writing any sink',
    async () => {
      boundary.target.mockRejectedValueOnce(
        new OrchestrationError('not_found', 'Workspace not found')
      )
      const request: AgentCliRequest = {
        ...stdout,
        workspaceId: selected,
        sink: { kind: 'sandbox-file', path: '/tmp/tips.md' },
      }
      expect(await executeSimCli({ request }, organization)).toEqual({
        success: false,
        error: 'Workspace not found',
      })
      expect(boundary.sink).not.toHaveBeenCalled()
      expect(boundary.route).not.toHaveBeenCalled()
    }
  )

  it('does not expose an unexpected authorization infrastructure failure', async () => {
    boundary.target.mockRejectedValueOnce(new Error('postgres://secret-host/private-schema'))
    expect(
      await executeSimCli({ request: { ...stdout, workspaceId: selected } }, organization)
    ).toEqual({
      success: false,
      error: 'The operation failed due to a system error. Please retry.',
    })
    expect(boundary.sink).not.toHaveBeenCalled()
  })

  it('still rejects explicit workspace targets for organization services', async () => {
    expect(
      await executeSimCli(
        {
          request: {
            workspaceId: selected,
            invocation: { kind: 'service', name: 'search_workspace', input: { query: 'policy' } },
          },
        },
        organization
      )
    ).toEqual({
      success: false,
      error: 'Account and organization services do not take a workspace target',
    })
    expect(boundary.target).not.toHaveBeenCalled()
    expect(boundary.route).not.toHaveBeenCalled()
  })
})
