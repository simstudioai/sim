import type { OAuthAccessTokenPrincipal, PersonalApiKeyPrincipal } from '@sim/auth/principal'
import { describe, expect, it, vi } from 'vitest'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import {
  credentialApiScopes,
  InsufficientScopeError,
  OAuthAccessTokenExpiredError,
  ReadOnlyApiKeyError,
  requireOAuthOperationScope,
} from '@/lib/core/application/oauth-authorization'
import { defineOperation } from '@/lib/core/application/operation'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const principal: OAuthAccessTokenPrincipal = {
  kind: 'oauth_access_token',
  userId: 'user-1',
  clientId: 'client-1',
  tokenId: 'token-1',
  scopes: ['api:read'],
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
}

const writeOperation = defineWorkspaceOperation({
  id: 'test.resource_acl_write',
  capability: 'none',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
  oauthScope: 'api:write',
})

describe('semantic OAuth policy', () => {
  it.each(['execute', 'authorize'] as const)(
    'rejects a read grant before canonical loading through %s',
    async (method) => {
      const resolveContext = vi.fn()
      const execute = vi.fn()
      const useCase = defineAuthorizedWorkspaceUseCase({
        operation: writeOperation,
        resolveContext,
        authorizationOptions: {},
        execute,
      })

      await expect(useCase[method]?.({ principal, input: {} })).rejects.toBeInstanceOf(
        InsufficientScopeError
      )
      expect(resolveContext).not.toHaveBeenCalled()
      expect(execute).not.toHaveBeenCalled()
    }
  )

  it('allows a write grant to satisfy a read while leaving session and API-key policy unchanged', () => {
    const readOperation = { ...writeOperation, oauthScope: 'api:read' } as const
    expect(() =>
      requireOAuthOperationScope({ ...principal, scopes: ['api:write'] }, readOperation)
    ).not.toThrow()
    expect(() =>
      requireOAuthOperationScope(
        { kind: 'session', userId: 'user-1', sessionId: 's-1' },
        writeOperation
      )
    ).not.toThrow()
    expect(() =>
      requireOAuthOperationScope(
        { kind: 'personal_api_key', userId: 'user-1', keyId: 'k-1', access: 'write' },
        writeOperation
      )
    ).not.toThrow()
  })

  it('holds a read-only key to api:read and refuses an operation that declares no scope', () => {
    const readKey: PersonalApiKeyPrincipal = {
      kind: 'personal_api_key',
      userId: 'user-1',
      keyId: 'k-1',
      access: 'read',
    }
    const unscopedOperation = defineWorkspaceOperation({
      id: 'test.unscoped_key_operation',
      capability: 'none',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      principalKinds: ['session', 'personal_api_key'],
    })

    for (const oauthScope of ['api:read', 'search:read'] as const) {
      expect(() =>
        requireOAuthOperationScope(readKey, { ...writeOperation, oauthScope })
      ).not.toThrow()
    }
    for (const operation of [writeOperation, unscopedOperation]) {
      let refusal: unknown
      try {
        requireOAuthOperationScope(readKey, operation)
      } catch (error) {
        refusal = error
      }
      expect(refusal).toBeInstanceOf(ReadOnlyApiKeyError)
      expect(refusal).not.toBeInstanceOf(InsufficientScopeError)
      expect(refusal).toMatchObject({ detailCode: 'READ_ONLY_API_KEY' })
    }
    expect(() =>
      requireOAuthOperationScope({ ...readKey, access: 'write' }, unscopedOperation)
    ).not.toThrow()
  })

  it.each([
    { case: 'a write token', credential: { ...principal, scopes: ['api:write'] } },
    { case: 'a read token', credential: principal },
    { case: 'a search-only token', credential: { ...principal, scopes: ['search:read'] } },
    {
      case: 'a read-only key',
      credential: { kind: 'personal_api_key', userId: 'user-1', keyId: 'k-1', access: 'read' },
    },
    {
      case: 'a full-access key',
      credential: { kind: 'personal_api_key', userId: 'user-1', keyId: 'k-1', access: 'write' },
    },
  ] as const)('reports exactly the scopes $case can reach', ({ credential }) => {
    const reachable = (['api:read', 'api:write', 'search:read'] as const).filter((oauthScope) => {
      try {
        requireOAuthOperationScope(credential, { ...writeOperation, oauthScope })
        return true
      } catch {
        return false
      }
    })
    expect(credentialApiScopes(credential)).toEqual(reachable)
  })

  it('rejects expiry before considering scope', () => {
    expect(() =>
      requireOAuthOperationScope({ ...principal, expiresAt: new Date(0) }, writeOperation)
    ).toThrow(OAuthAccessTokenExpiredError)
  })

  it.each([undefined, 'offline_access'])(
    'rejects an invalid scope policy %s at definition time',
    (oauthScope) => {
      expect(() =>
        defineOperation({
          id: 'test.principal_policy',
          capability: 'none',
          principalKinds: ['oauth_access_token'],
          oauthScope,
        } as never)
      ).toThrow('must declare its OAuth scope')
      expect(() => defineWorkspaceOperation({ ...writeOperation, oauthScope } as never)).toThrow(
        'must declare its OAuth scope'
      )
    }
  )

  it('refuses scope metadata on an operation that does not admit OAuth', () => {
    expect(() =>
      defineOperation({
        id: 'test.session_policy',
        capability: 'none',
        principalKinds: ['session'],
        oauthScope: 'api:read',
      } as never)
    ).toThrow('declares OAuth scope without admitting OAuth')
    expect(() =>
      defineWorkspaceOperation({ ...writeOperation, principalKinds: ['session'] } as never)
    ).toThrow('declares OAuth scope without admitting OAuth')
  })
})
