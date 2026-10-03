import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ organization: vi.fn(), workspace: vi.fn() }))
vi.mock('@/lib/mothership/application/execute-organization-secret-use-case', () => ({
  executeOrganizationSecretUseCase: mocks.organization,
}))
vi.mock('@/lib/mothership/tools/secret-mount-materializer.server', () => ({
  materializeCopilotCodeSecrets: mocks.workspace,
}))

import { materializeOrganizationCodeSecrets } from '@/lib/mothership/tools/organization-secret-mount'
import {
  listOrganizationSecretNames,
  mountOrganizationSecrets,
} from '@/lib/organization-secrets/application/use-cases'

const context = {
  userId: 'actor',
  organizationId: 'org',
  workflowId: '',
  chatId: 'chat',
  toolCallId: 'call',
  copilotToolExecution: true,
  requestMode: 'agent',
}
const mounted = {
  envVars: { TOKEN: 'private' },
  catalogEntries: [{ name: 'TOKEN', plaintext: 'private', encryptedValue: 'cipher' }],
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.organization.mockImplementation(async (_ctx, operation) =>
    operation === listOrganizationSecretNames ? { names: ['TOKEN'] } : mounted
  )
  mocks.workspace.mockResolvedValue({
    envVars: { WORKSPACE: 'workspace-secret' },
    catalogEntries: [],
  })
})
describe('Generic Secrets code mounts', () => {
  it.each(['agent', 'plan'])(
    'mounts a source secret in %s without requiring a workspace',
    async (requestMode) => {
      expect(
        await materializeOrganizationCodeSecrets({ ...context, requestMode }, ['TOKEN'])
      ).toEqual(mounted)
      expect(mocks.organization).toHaveBeenLastCalledWith(
        expect.objectContaining({ organizationId: 'org', workspaceId: undefined }),
        mountOrganizationSecrets,
        { names: ['TOKEN'] }
      )
      expect(mocks.workspace).not.toHaveBeenCalled()
    }
  )
  it('preserves org scope when code targets a workspace and uses workspace secrets only as fallback', async () => {
    const result = await materializeOrganizationCodeSecrets(
      { ...context, organizationId: undefined, chatOrganizationId: 'org', workspaceId: 'target' },
      ['TOKEN', 'WORKSPACE']
    )
    expect(result.envVars).toEqual({ TOKEN: 'private', WORKSPACE: 'workspace-secret' })
    expect(mocks.workspace).toHaveBeenCalledWith({
      actorUserId: 'actor',
      workspaceId: 'target',
      requestedNames: ['WORKSPACE'],
    })
  })
  it.each([{ requestMode: 'assistant' }, { requestMode: undefined }, { secretActorUserId: null }])(
    'denies raw mounts for %j',
    async (change) => {
      await expect(
        materializeOrganizationCodeSecrets({ ...context, ...change }, ['TOKEN'])
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect(mocks.organization).not.toHaveBeenCalled()
    }
  )
  it('does not silently accept an unknown or revoked secret', async () => {
    await expect(materializeOrganizationCodeSecrets(context, ['MISSING'])).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.organization).toHaveBeenCalledOnce()
  })
})
