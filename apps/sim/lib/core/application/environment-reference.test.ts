import { environmentUtilsMockFns, resetEnvironmentUtilsMock } from '@sim/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { markCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
import {
  resolveCopilotSecretReference,
  resolvePrincipalEnvironmentVariable,
} from '@/lib/core/application/environment-reference'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'

const WORKSPACE_ID = 'workspace-1'

function copilotPrincipal({ admitted = true } = {}) {
  const principal = createCopilotChatPrincipal(
    { userId: 'user-1', workspaceId: WORKSPACE_ID, chatId: 'chat-1' },
    'sim:chat-deployments'
  )
  if (admitted) markCopilotWorkspaceInvocation(principal)
  return principal
}

const sessionPrincipal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }

function environment(variables: Record<string, string>) {
  environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables.mockResolvedValueOnce(
    Object.fromEntries(
      Object.entries(variables).map(([name, value]) => [
        name,
        { value, scope: 'workspace', visible: false },
      ])
    )
  )
}

describe('resolveCopilotSecretReference', () => {
  afterEach(resetEnvironmentUtilsMock)

  it("resolves an agent's whole-value reference from the subject user's environment", async () => {
    environment({ CHAT_PASSWORD: 'newly-created-password' })

    await expect(
      resolveCopilotSecretReference(
        copilotPrincipal(),
        WORKSPACE_ID,
        '{{ CHAT_PASSWORD }}',
        'password'
      )
    ).resolves.toBe('newly-created-password')
    expect(environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables).toHaveBeenCalledWith(
      'user-1',
      WORKSPACE_ID,
      ['CHAT_PASSWORD']
    )
  })

  it('refuses an unset variable by name instead of storing the placeholder', async () => {
    await expect(
      resolveCopilotSecretReference(copilotPrincipal(), WORKSPACE_ID, '{{CHAT_PW}}', 'password')
    ).rejects.toMatchObject({
      code: 'validation',
      message:
        'Environment variable "CHAT_PW" referenced by password is not set for this workspace or user. Set it first, or pass the raw value.',
    })
  })

  it('refuses an empty variable the same way as an unset one', async () => {
    environment({ CHAT_PW: '' })

    await expect(
      resolveCopilotSecretReference(copilotPrincipal(), WORKSPACE_ID, '{{CHAT_PW}}', 'password')
    ).rejects.toMatchObject({ code: 'validation', message: expect.stringContaining('"CHAT_PW"') })
  })

  it('leaves literal and embedded-reference passwords alone without loading the environment', async () => {
    for (const value of ['$literal_password', 'prefix-{{CHAT_PW}}', undefined]) {
      await expect(
        resolveCopilotSecretReference(copilotPrincipal(), WORKSPACE_ID, value, 'password')
      ).resolves.toBe(value)
    }
    expect(environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables).not.toHaveBeenCalled()
  })

  it('keeps literal semantics for every caller that is not an admitted agent invocation', async () => {
    for (const principal of [sessionPrincipal, copilotPrincipal({ admitted: false })]) {
      await expect(
        resolveCopilotSecretReference(principal, WORKSPACE_ID, '{{CHAT_PW}}', 'password')
      ).resolves.toBe('{{CHAT_PW}}')
    }
    expect(environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables).not.toHaveBeenCalled()
  })
})

describe('resolvePrincipalEnvironmentVariable', () => {
  afterEach(resetEnvironmentUtilsMock)

  it('refuses a principal with no subject user', async () => {
    await expect(
      resolvePrincipalEnvironmentVariable(
        { kind: 'workspace_api_key', workspaceId: WORKSPACE_ID, keyId: 'key-1' },
        WORKSPACE_ID,
        'CHAT_PW'
      )
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables).not.toHaveBeenCalled()
  })
})
