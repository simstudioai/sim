import { describe, expect, it } from 'vitest'
import { canOpenSecretDetail } from './secret-detail-access'

const allowedAccess = {
  credential: { workspaceId: 'workspace-a', type: 'env_workspace' },
  hasWorkspaceAccess: true,
  hasActiveMembership: true,
  isAdmin: false,
}

describe('canOpenSecretDetail', () => {
  it('allows active members and derived admins for matching environment credentials', () => {
    expect(
      canOpenSecretDetail({
        workspaceId: 'workspace-a',
        secretsHidden: false,
        access: allowedAccess,
      })
    ).toBe(true)
    expect(
      canOpenSecretDetail({
        workspaceId: 'workspace-a',
        secretsHidden: false,
        access: {
          ...allowedAccess,
          credential: { workspaceId: 'workspace-a', type: 'env_personal' },
          hasActiveMembership: false,
          isAdmin: true,
        },
      })
    ).toBe(true)
  })

  it.each([
    ['missing credential', { ...allowedAccess, credential: null }, false],
    [
      'cross-workspace credential',
      {
        ...allowedAccess,
        credential: { workspaceId: 'workspace-b', type: 'env_workspace' },
      },
      false,
    ],
    [
      'wrong credential type',
      { ...allowedAccess, credential: { workspaceId: 'workspace-a', type: 'oauth' } },
      false,
    ],
    ['missing workspace access', { ...allowedAccess, hasWorkspaceAccess: false }, false],
    [
      'missing credential membership',
      { ...allowedAccess, hasActiveMembership: false, isAdmin: false },
      false,
    ],
  ])('rejects %s', (_label, access, expected) => {
    expect(
      canOpenSecretDetail({
        workspaceId: 'workspace-a',
        secretsHidden: false,
        access,
      })
    ).toBe(expected)
  })

  it('rejects permission-group hidden Secrets', () => {
    expect(
      canOpenSecretDetail({
        workspaceId: 'workspace-a',
        secretsHidden: true,
        access: allowedAccess,
      })
    ).toBe(false)
  })
})
