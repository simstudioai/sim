import { describe, expect, it } from 'vitest'
import type { WorkspaceCredential } from '@/lib/api/contracts'
import { selectRawMountableSecretNames } from '@/lib/credentials/secret-mount-options'

function credential(
  overrides: Partial<WorkspaceCredential> & Pick<WorkspaceCredential, 'id' | 'type'>
): WorkspaceCredential {
  return {
    workspaceId: 'workspace-1',
    displayName: overrides.id,
    description: null,
    providerId: null,
    accountId: null,
    envKey: null,
    envOwnerUserId: null,
    createdBy: 'user-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('selectRawMountableSecretNames', () => {
  it('keeps only admin environment credentials and returns unique sorted names', () => {
    const credentials = [
      credential({ id: 'workspace-z', type: 'env_workspace', envKey: 'ZETA', role: 'admin' }),
      credential({ id: 'personal-a', type: 'env_personal', envKey: 'ALPHA', role: 'admin' }),
      credential({ id: 'duplicate-a', type: 'env_workspace', envKey: 'ALPHA', role: 'admin' }),
      credential({ id: 'member', type: 'env_workspace', envKey: 'MEMBER', role: 'member' }),
      credential({ id: 'oauth', type: 'oauth', envKey: 'OAUTH', role: 'admin' }),
      credential({ id: 'missing-key', type: 'env_personal', envKey: null, role: 'admin' }),
    ]

    expect(selectRawMountableSecretNames(credentials)).toEqual(['ALPHA', 'ZETA'])
  })
})
