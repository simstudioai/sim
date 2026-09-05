/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { defineWorkspaceOperation } from '@/lib/core/application'
import {
  credentialOperations,
  defineCredentialOperation,
} from '@/lib/credentials/application/operations'

describe('credential operations', () => {
  it('declares credential admin as the delete authority and workspace read as reach', () => {
    expect(credentialOperations.delete).toMatchObject({
      id: 'credentials.delete',
      minimumRole: 'read',
      minimumCredentialRole: 'admin',
      workspaceApiKey: 'deny',
      principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
      delegatedServices: ['copilot'],
    })
    expect(Object.isFrozen(credentialOperations.delete)).toBe(true)
  })

  /**
   * The rotation surface leans on this: `PATCH /api/v2/credentials/{id}` is
   * reachable by a personal key, and its refusal for a workspace key is the
   * operation's principal list rather than anything the route does.
   */
  it('declares the same authority for update as for delete', () => {
    expect(credentialOperations.update).toMatchObject({
      id: 'credentials.update',
      minimumRole: 'read',
      minimumCredentialRole: 'admin',
      workspaceApiKey: 'deny',
      principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
      delegatedServices: ['copilot'],
    })
    expect(credentialOperations.update.principalKinds).not.toContain('workspace_api_key')
  })

  it('rejects actorless workspace keys for credential admin operations', () => {
    const workspaceKeyOperation = defineWorkspaceOperation({
      id: 'credentials.test_admin',
      minimumRole: 'read',
      workspaceApiKey: 'allow',
      principalKinds: ['workspace_api_key'],
      capability: 'integrations.manage',
    })

    expect(() => defineCredentialOperation(workspaceKeyOperation, 'admin')).toThrow(
      'Credential operation credentials.test_admin requires a user-bearing principal'
    )
  })
})
