import { beforeEach, expect, it, vi } from 'vitest'
import { markCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'

const { access } = vi.hoisted(() => ({ access: vi.fn() }))
vi.mock('@/lib/auth/credential-access', () => ({ authorizeCredentialUseForAuth: access }))

import { authorizeWorkflowBindingCredentials } from './binding-targets'
import type { WorkflowImportPlan } from './import-plan'

const plan: Pick<WorkflowImportPlan, 'bindings'> = {
  bindings: [
    {
      kind: 'credential',
      sourceId: 'old',
      targetId: 'connection',
      required: true,
      occurrence: {
        blockId: 'block',
        subBlockKey: 'credential',
        valuePath: [],
        encoding: 'scalar',
      },
    },
  ],
}
beforeEach(() => {
  access.mockResolvedValue({ ok: true, workspaceId: 'workspace' })
})
it.each(['sim:workspaces', 'sim:workflows'])(
  'checks actual Copilot actor credential access for %s',
  async (audience) => {
    const principal = {
      ...createCopilotChatPrincipal(
        { userId: 'actor', workspaceId: 'workspace', chatId: 'chat' },
        audience
      ),
    }
    markCopilotWorkspaceInvocation(principal)
    await authorizeWorkflowBindingCredentials(principal, 'workspace', plan)
    expect(access).toHaveBeenCalledWith(
      { success: true, userId: 'actor' },
      { workspaceId: 'workspace', credentialId: 'connection' }
    )
    access.mockResolvedValueOnce({ ok: false })
    await expect(authorizeWorkflowBindingCredentials(principal, 'workspace', plan)).rejects.toThrow(
      'access to the destination'
    )
  }
)
it.each(['unbranded', 'wrong-workspace', 'wrong-audience', 'expired'])(
  'rejects %s before credential resolution',
  async (kind) => {
    const principal = {
      ...createCopilotChatPrincipal(
        {
          userId: 'actor',
          workspaceId: kind === 'wrong-workspace' ? 'other' : 'workspace',
          chatId: 'chat',
        },
        kind === 'wrong-audience' ? 'sim:files' : 'sim:workflows'
      ),
    }
    if (kind !== 'unbranded') markCopilotWorkspaceInvocation(principal)
    if (kind === 'expired') principal.expiresAt = new Date(0)
    await expect(
      authorizeWorkflowBindingCredentials(principal, 'workspace', plan)
    ).rejects.toThrow()
    expect(access).not.toHaveBeenCalled()
  }
)
