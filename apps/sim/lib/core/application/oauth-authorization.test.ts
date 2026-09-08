/**
 * @vitest-environment node
 */
import type { OAuthAccessTokenPrincipal } from '@sim/auth/principal'
import { describe, expect, it, vi } from 'vitest'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import {
  InsufficientScopeError,
  OAuthAccessTokenExpiredError,
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
        { kind: 'personal_api_key', userId: 'user-1', keyId: 'k-1' },
        writeOperation
      )
    ).not.toThrow()
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
