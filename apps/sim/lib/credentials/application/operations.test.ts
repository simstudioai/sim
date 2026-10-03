import { describe, expect, it } from 'vitest'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineCredentialOperation } from '@/lib/credentials/application/operations'

describe('credential operations', () => {
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
