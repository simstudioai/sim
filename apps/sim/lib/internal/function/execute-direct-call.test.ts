import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runSandbox: vi.fn() }))

vi.mock('@/lib/function-execution/execute-request', () => ({
  executeFunctionRequest: mocks.runSandbox,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

import type { Principal } from '@sim/auth/principal'
import { markCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
import { PrincipalKindAuthorizationError } from '@/lib/core/application/workspace-authorization'
import { executeFunctionTool } from '@/lib/internal/function/execute'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import { TOOL_EXECUTION_DELEGATION_AUDIENCE } from '@/lib/tool-execution/application/operations'

/**
 * `POST /api/v2/tools/{id}/execute` (the embedded CLI's `tools execute`) runs `function_execute`
 * with no workflow behind it, so no executor origin exists. The real function-execution policy
 * decides from the authenticated caller; only the sandbox is stubbed.
 */
function runDirect(callerPrincipal: Principal) {
  return executeFunctionTool({
    body: { code: 'return 1' },
    headers: new Headers(),
    requestId: 'request-1',
    context: { workflowId: '', workspaceId: 'workspace-1', userId: 'user-1', callerPrincipal },
  })
}

describe('executeFunctionTool direct tool calls', () => {
  beforeEach(() => {
    workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      billedAccountUserId: 'user-1',
      allowPersonalApiKeys: true,
    })
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
    mocks.runSandbox.mockResolvedValue(Response.json({ success: true, output: { result: 1 } }))
  })

  it('runs the code for an admitted Mothership caller', async () => {
    const caller = createCopilotChatPrincipal(
      { userId: 'user-1', workspaceId: 'workspace-1', chatId: 'chat-1' },
      TOOL_EXECUTION_DELEGATION_AUDIENCE
    )
    markCopilotWorkspaceInvocation(caller)

    const response = await runDirect(caller)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, output: { result: 1 } })
  })

  it('still refuses a personal API key before any code runs', async () => {
    await expect(runDirect(createPersonalApiKeyPrincipal({ keyId: 'key-1' }))).rejects.toThrow(
      PrincipalKindAuthorizationError
    )
    expect(mocks.runSandbox).not.toHaveBeenCalled()
  })
})
