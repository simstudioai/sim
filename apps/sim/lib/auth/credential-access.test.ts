/**
 * @vitest-environment node
 */
import { account, credential, credentialMember, workflow } from '@sim/db/schema'
import { createMockRequest, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckSessionOrInternalAuth, mockResolveWorkspaceAccess, mockGetUserEntityPermissions } =
  vi.hoisted(() => ({
    mockCheckSessionOrInternalAuth: vi.fn(),
    mockResolveWorkspaceAccess: vi.fn(),
    mockGetUserEntityPermissions: vi.fn(),
  }))

vi.mock('@/lib/auth/hybrid', () => ({
  AuthType: { SESSION: 'session', API_KEY: 'api_key', INTERNAL_JWT: 'internal_jwt' },
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockResolveWorkspaceAccess,
  getUserEntityPermissions: mockGetUserEntityPermissions,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

import { authorizeCredentialUse, authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'

afterAll(resetDbChainMock)

const OWNER = 'owner-user'
const WORKSPACE = 'ws-1'
const ACCOUNT_ID = 'acct-1'

const workspaceAdmin = { hasAccess: true, canWrite: true, canAdmin: true }
const workspaceWriter = { hasAccess: true, canWrite: true, canAdmin: false }
const noWorkspaceAccess = { hasAccess: false, canWrite: false, canAdmin: false }

const platformCredential = {
  id: 'cred-1',
  workspaceId: WORKSPACE,
  type: 'oauth',
  accountId: ACCOUNT_ID,
}

function actAs(userId: string) {
  mockCheckSessionOrInternalAuth.mockResolvedValue({ success: true, userId, authType: 'session' })
}

/** The rows `getCredentialActorContext` reads: the credential, then the caller's membership. */
function queueActorContext(
  credentialRow: Record<string, unknown>,
  membership: { role: string }[] = []
) {
  queueTableRows(credential, [credentialRow])
  queueTableRows(credentialMember, membership)
}

/** The rows `resolveCredentialTokenIdentity` reads: the credential, then its account. */
function queueTokenIdentity(
  credentialRow: Record<string, unknown> | null,
  ownerUserId: string | null
) {
  queueTableRows(credential, credentialRow ? [credentialRow] : [])
  queueTableRows(account, ownerUserId ? [{ userId: ownerUserId }] : [])
}

function authorize(credentialId: string, workflowId?: string) {
  return authorizeCredentialUse(createMockRequest('POST'), { credentialId, workflowId })
}

describe('authorizeCredentialUse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    actAs('acting-user')
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockResolveWorkspaceAccess.mockResolvedValue(workspaceWriter)
  })

  describe('workspace-scoped credentials, without a workflow', () => {
    it('authorizes a workspace admin who did not run the OAuth flow', async () => {
      queueActorContext(platformCredential)
      queueTokenIdentity(platformCredential, OWNER)
      mockResolveWorkspaceAccess.mockResolvedValue(workspaceAdmin)

      const result = await authorize('cred-1')

      expect(result.ok).toBe(true)
      expect(result.credentialOwnerUserId).toBe(OWNER)
      expect(result.resolvedCredentialId).toBe(ACCOUNT_ID)
      expect(result.workspaceId).toBe(WORKSPACE)
    })

    it('authorizes an active credential member who did not run the OAuth flow', async () => {
      queueActorContext(platformCredential, [{ role: 'member' }])
      queueTokenIdentity(platformCredential, OWNER)

      const result = await authorize('cred-1')

      expect(result.ok).toBe(true)
      expect(result.credentialOwnerUserId).toBe(OWNER)
    })

    it('rejects a workspace member who is not a credential member', async () => {
      queueActorContext(platformCredential)

      const result = await authorize('cred-1')

      expect(result.ok).toBe(false)
      expect(result.error).toContain('add you as a member')
    })

    it('rejects a caller who has lost access to the credential workspace', async () => {
      queueActorContext(platformCredential)
      mockResolveWorkspaceAccess.mockResolvedValue(noWorkspaceAccess)

      const result = await authorize('cred-1')

      expect(result.ok).toBe(false)
      expect(result.error).toBe('You do not have access to this workspace.')
    })

    it('rejects when the credential owner has lost access to the workspace', async () => {
      queueActorContext(platformCredential)
      queueTokenIdentity(platformCredential, OWNER)
      mockResolveWorkspaceAccess.mockResolvedValue(workspaceAdmin)
      mockGetUserEntityPermissions.mockResolvedValue(null)

      const result = await authorize('cred-1')

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Unauthorized')
    })
  })

  describe('workflow scope', () => {
    it('rejects a credential belonging to another workspace', async () => {
      queueTableRows(workflow, [{ workspaceId: 'other-ws' }])
      queueActorContext(platformCredential)

      const result = await authorize('cred-1', 'wf-1')

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Credential is not accessible from this workflow workspace')
    })
  })

  describe('legacy account ids', () => {
    const sharedRow = { id: 'cred-1', workspaceId: WORKSPACE, type: 'oauth' }

    it('resolves through an accessible workspace credential without a workflow', async () => {
      queueTableRows(credential, []) // platform lookup miss
      queueTableRows(credential, [sharedRow]) // shared rows wrapping the account
      queueActorContext(sharedRow)
      queueTokenIdentity(null, OWNER)
      mockResolveWorkspaceAccess.mockResolvedValue(workspaceAdmin)

      const result = await authorize(ACCOUNT_ID)

      expect(result.ok).toBe(true)
      expect(result.credentialOwnerUserId).toBe(OWNER)
      expect(result.workspaceId).toBe(WORKSPACE)
      expect(result.resolvedCredentialId).toBe(ACCOUNT_ID)
    })

    it('rejects when no workspace credential is reachable by the caller', async () => {
      queueTableRows(credential, [])
      queueTableRows(credential, [sharedRow])
      queueActorContext(sharedRow)
      queueTableRows(account, [{ userId: OWNER }])

      const result = await authorize(ACCOUNT_ID)

      expect(result.ok).toBe(false)
      expect(result.error).toContain('add you as a member')
    })

    it('still authorizes the owner when a shared row rejects them', async () => {
      actAs(OWNER)
      queueTableRows(credential, [])
      queueTableRows(credential, [{ id: 'cred-1', workspaceId: 'other-ws', type: 'oauth' }])
      queueActorContext({ id: 'cred-1', workspaceId: 'other-ws', type: 'oauth' })
      queueTableRows(account, [{ userId: OWNER }])

      const result = await authorize(ACCOUNT_ID)

      expect(result.ok).toBe(true)
      expect(result.credentialOwnerUserId).toBe(OWNER)
    })

    it('does not fall back to the owner path when a workflow pins the workspace', async () => {
      actAs(OWNER)
      queueTableRows(workflow, [{ workspaceId: WORKSPACE }])
      queueTableRows(credential, [])
      queueTableRows(credential, [])
      queueTableRows(account, [{ userId: OWNER }])

      const result = await authorize(ACCOUNT_ID, 'wf-1')

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Credential not found')
    })

    it('keeps an unshared account private to its owner', async () => {
      queueTableRows(credential, [])
      queueTableRows(credential, [])
      queueTableRows(account, [{ userId: OWNER }])

      const result = await authorize(ACCOUNT_ID)

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Unauthorized')
    })

    it('authorizes the owner of an unshared account', async () => {
      actAs(OWNER)
      queueTableRows(credential, [])
      queueTableRows(credential, [])
      queueTableRows(account, [{ userId: OWNER }])

      const result = await authorize(ACCOUNT_ID)

      expect(result.ok).toBe(true)
      expect(result.credentialOwnerUserId).toBe(OWNER)
    })

    it('reports an unknown credential id', async () => {
      queueTableRows(credential, [])
      queueTableRows(credential, [])
      queueTableRows(account, [])

      const result = await authorize('nope')

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Credential not found')
    })
  })

  /**
   * The in-process tool executor synthesizes the AuthResult an internal JWT
   * would have produced instead of minting one and POSTing to ourselves, so the
   * subject-less case must still fail closed here.
   */
  describe('authorizeCredentialUseForAuth', () => {
    it('fails closed when the authenticated caller carries no user id', async () => {
      const result = await authorizeCredentialUseForAuth(
        { success: true, authType: 'internal_jwt' },
        { credentialId: ACCOUNT_ID }
      )

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Authentication required')
    })

    it('fails closed when authentication did not succeed', async () => {
      const result = await authorizeCredentialUseForAuth(
        { success: false, error: 'Unauthorized' },
        { credentialId: ACCOUNT_ID }
      )

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Unauthorized')
    })

    it('rejects an asserted caller that does not match the internal token subject', async () => {
      const result = await authorizeCredentialUseForAuth(
        { success: true, userId: OWNER, authType: 'internal_jwt' },
        { credentialId: ACCOUNT_ID, callerUserId: 'someone-else' }
      )

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Caller user does not match internal token subject')
    })
  })
})
