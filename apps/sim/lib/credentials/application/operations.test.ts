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
      principalKinds: ['session', 'personal_api_key', 'delegated'],
      delegatedServices: ['copilot'],
    })
    expect(Object.isFrozen(credentialOperations.delete)).toBe(true)
  })

  it('rejects actorless workspace keys for credential admin operations', () => {
    const workspaceKeyOperation = defineWorkspaceOperation({
      id: 'credentials.test_admin',
      minimumRole: 'read',
      workspaceApiKey: 'allow',
      principalKinds: ['workspace_api_key'],
    })

    expect(() => defineCredentialOperation(workspaceKeyOperation, 'admin')).toThrow(
      'Credential operation credentials.test_admin requires a user-bearing principal'
    )
  })
})
