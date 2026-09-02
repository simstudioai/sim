/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createCopilotManagedOAuthPrincipal } from '@/lib/credentials/application/copilot-managed-oauth-delegation'

const trustedContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
  toolCallId: 'call-1',
  copilotToolExecution: true as const,
}

describe('createCopilotManagedOAuthPrincipal', () => {
  it('names the signed-in user, the managed-credential audience, and exactly one credential', () => {
    const principal = createCopilotManagedOAuthPrincipal(trustedContext, 'credential-1')

    expect(principal).toMatchObject({
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'copilot-tool:call-1',
      audience: 'sim:managed-oauth-credentials',
      resourceScope: { credentialId: 'credential-1', chatId: 'chat-1' },
    })
    expect(principal.expiresAt.getTime()).toBeGreaterThan(principal.issuedAt.getTime())
  })

  it('refuses a context the server did not classify as a Chat tool call', () => {
    expect(() =>
      createCopilotManagedOAuthPrincipal({ ...trustedContext, copilotToolExecution: false }, 'c-1')
    ).toThrow('trusted Copilot execution context')
    expect(() => createCopilotManagedOAuthPrincipal(undefined, 'c-1')).toThrow(
      'Copilot execution context is required'
    )
  })
})
