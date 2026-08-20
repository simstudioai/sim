/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineWorkspaceOperation } from '@/lib/core/application'
import {
  CredentialAccessRequiredError,
  defineAuthorizedCredentialUseCase,
  requireManageableCredentialType,
} from '@/lib/credentials/application/authorized-credential-use-case'
import { defineCredentialOperation } from '@/lib/credentials/application/operations'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
  getActor: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mocks.getActor,
}))

const memberOperation = defineCredentialOperation(
  defineWorkspaceOperation({
    id: 'credentials.test_member',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  'member'
)
const adminOperation = defineCredentialOperation(
  defineWorkspaceOperation({
    id: 'credentials.test_admin',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  'admin'
)
const principal = {
  kind: 'session' as const,
  userId: 'user-1',
  sessionId: 'session-1',
}
const credential = {
  id: 'credential-1',
  workspaceId: 'workspace-1',
  type: 'oauth' as const,
}
const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
  credential,
}

function createUseCase(operation: typeof memberOperation | typeof adminOperation) {
  return defineAuthorizedCredentialUseCase({
    operation,
    resolveContext: async () => ({ ...context }),
    execute: mocks.execute,
  })
}

describe('defineAuthorizedCredentialUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.execute.mockResolvedValue({ ok: true })
    mocks.getActor.mockResolvedValue({
      credential,
      member: { role: 'member', status: 'active' },
      hasWorkspaceAccess: true,
      isAdmin: false,
    })
  })

  it('allows an active credential member for member-level reads', async () => {
    await expect(
      createUseCase(memberOperation).execute({ principal, input: undefined })
    ).resolves.toEqual({ ok: true })
    expect(mocks.execute).toHaveBeenCalledOnce()
  })

  it('denies member-level reads without credential membership', async () => {
    mocks.getActor.mockResolvedValue({
      credential,
      member: null,
      hasWorkspaceAccess: true,
      isAdmin: false,
    })

    await expect(
      createUseCase(memberOperation).execute({ principal, input: undefined })
    ).rejects.toBeInstanceOf(CredentialAccessRequiredError)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('requires credential admin independently of workspace read access', async () => {
    await expect(
      createUseCase(adminOperation).execute({ principal, input: undefined })
    ).rejects.toMatchObject({
      code: 'forbidden',
      detailCode: 'CREDENTIAL_ADMIN_ACCESS_REQUIRED',
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('authorizes the workspace before resolving credential membership', async () => {
    await createUseCase(memberOperation).execute({ principal, input: undefined })

    expect(mocks.resolvePermission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getActor.mock.invocationCallOrder[0]
    )
  })
})

/**
 * The table each credential-scoped operation applies before it mutates.
 *
 * The API-key row is the one with teeth: `v2CredentialTypeSchema` publishes only
 * `oauth | service_account` and `toV2Credential` throws on anything else, so an
 * `env_*` row reaching a public credential route would be a caller-reachable
 * 500 rather than a refusal.
 */
describe('requireManageableCredentialType', () => {
  const sessionPrincipal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
  const apiKeyPrincipal = {
    kind: 'personal_api_key' as const,
    userId: 'user-1',
    keyId: 'key-1',
  }
  const delegatedPrincipal = {
    kind: 'delegated' as const,
    service: 'copilot' as const,
    subject: { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' },
  }

  const credentialOfType = (type: string) => ({ type }) as Pick<typeof credential, 'type'>

  it.each(['oauth', 'service_account', 'env_workspace', 'env_personal'])(
    'lets a session manage a %s credential',
    (type) => {
      expect(() =>
        requireManageableCredentialType(sessionPrincipal, credentialOfType(type))
      ).not.toThrow()
    }
  )

  it.each(['oauth', 'service_account'])('lets an API key manage a %s credential', (type) => {
    expect(() =>
      requireManageableCredentialType(apiKeyPrincipal, credentialOfType(type))
    ).not.toThrow()
  })

  it.each(['env_workspace', 'env_personal'])(
    'refuses an API key on a %s credential the public schema cannot express',
    (type) => {
      expect(() =>
        requireManageableCredentialType(apiKeyPrincipal, credentialOfType(type))
      ).toThrowError(/Only oauth, service_account credentials can be managed by this caller/)
    }
  )

  it.each(['service_account', 'env_workspace', 'env_personal'])(
    'confines Copilot to oauth, refusing %s',
    (type) => {
      expect(() =>
        requireManageableCredentialType(delegatedPrincipal, credentialOfType(type))
      ).toThrowError(/Only oauth credentials can be managed by this caller/)
    }
  )
})
