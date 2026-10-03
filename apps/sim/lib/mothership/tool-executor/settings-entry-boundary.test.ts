import {
  mothershipEnvironmentContextMock,
  mothershipEnvironmentContextMockFns,
} from '@sim/testing/mocks/mothership-environment-context.mock'
import {
  mothershipWorkspaceTargetMock,
  mothershipWorkspaceTargetMockFns,
} from '@sim/testing/mocks/mothership-workspace-target.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

vi.mock('@/lib/mothership/application/workspace-target', () => mothershipWorkspaceTargetMock)
vi.mock('@/lib/mothership/environment-context', () => mothershipEnvironmentContextMock)

import {
  clearHandlers,
  executeTool,
  registerHandler,
} from '@/lib/mothership/tool-executor/executor'
import { createServerToolHandler } from '@/lib/mothership/tools/registry/server-tool-adapter'
import { readSettingsWorkspaceContext } from '@/lib/settings/application/context'

const boundary = {
  target: mothershipWorkspaceTargetMockFns.mockResolveInvocationWorkspace,
  environment: mothershipEnvironmentContextMockFns.mockPrepareCopilotEnvironmentContext,
}

const workspaceId = '11111111-1111-4111-8111-111111111111'
const context = {
  userId: 'actor',
  workflowId: '',
  organizationId: 'organization',
  chatId: 'organization-chat',
  toolCallId: 'call',
  copilotToolExecution: true,
  requestMode: 'agent',
  targetWorkspaceId: workspaceId,
}
beforeEach(() => {
  vi.spyOn(readSettingsWorkspaceContext, 'execute').mockResolvedValue({
    workspaceId,
    organizationId: 'organization',
  })
  clearHandlers()
  registerHandler('settings', createServerToolHandler('settings'))
  boundary.target.mockImplementation(async (_context, target) => {
    if (target !== workspaceId) throw new Error('Explicit target required')
    return { workspaceId, permission: 'admin' }
  })
  boundary.environment.mockImplementation(async () => ({
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
      userId: 'actor',
      workspaceId,
    }),
  }))
})
describe('organization executor to settings entry', () => {
  it('resolves the explicit target, preserves organization chat authority and exposes secure key creation hint', async () => {
    const result = await executeTool(
      'settings',
      { scope: 'workspace', action: 'list', workspaceId },
      context
    )
    expect(result.success).toBe(true)
    expect(boundary.target).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ organizationId: 'organization', chatId: 'organization-chat' }),
      workspaceId
    )
    expect(boundary.target).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        workspaceId,
        chatOrganizationId: 'organization',
        chatId: 'organization-chat',
      }),
      workspaceId
    )
    expect(boundary.target.mock.calls[1][0].organizationId).toBeUndefined()
    expect(result.output).toMatchObject({
      scope: 'workspace',
      sections: expect.arrayContaining([
        expect.objectContaining({
          id: 'api-keys',
          userSetup: expect.stringContaining('generate_api_key'),
        }),
      ]),
    })
  })
  it('refuses a mismatched model assertion after resolving the trusted target', async () => {
    const result = await executeTool(
      'settings',
      { scope: 'workspace', action: 'list', workspaceId: '22222222-2222-4222-8222-222222222222' },
      context
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('Workspace not found')
    expect(boundary.target).toHaveBeenCalledTimes(1)
  })
  it('refuses an organization workspace operation without explicit target', async () => {
    const result = await executeTool(
      'settings',
      { scope: 'workspace', action: 'list' },
      { ...context, targetWorkspaceId: undefined }
    )
    expect(result.success).toBe(false)
    expect(boundary.environment).not.toHaveBeenCalled()
  })
  it('refuses a revoked target before preparing the workspace environment', async () => {
    boundary.target.mockRejectedValue(new Error('Workspace access revoked'))
    const result = await executeTool(
      'settings',
      { scope: 'workspace', action: 'list', workspaceId },
      context
    )
    expect(result).toEqual({ success: false, error: 'Workspace access revoked' })
    expect(boundary.environment).not.toHaveBeenCalled()
  })
})
