/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getFile: vi.fn(),
  getShare: vi.fn(),
  loadContext: vi.fn(),
  recordAudit: vi.fn(),
  resolvePermission: vi.fn(),
  upsertShare: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_SHARED: 'FILE_SHARED', FILE_SHARE_DISABLED: 'FILE_SHARE_DISABLED' },
  AuditResourceType: { FILE: 'FILE' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/auth/principal', () => ({
  resolvePrincipalAttribution: () => ({ attributedUserId: 'user-1' }),
  resolvePrincipalAuditAttribution: () => ({
    actorId: 'user-1',
    actorName: null,
    actor: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
  }),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  getShareForResource: mocks.getShare,
  ShareValidationError: class ShareValidationError extends Error {},
  upsertFileShare: mocks.upsertShare,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: mocks.getFile,
  loadActiveWorkspaceFileContext: mocks.loadContext,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  PublicFileSharingNotAllowedError: class PublicFileSharingNotAllowedError extends Error {},
  validatePublicFileSharing: vi.fn(),
}))

import { unshareWorkspaceFile } from '@/lib/workspace-files/application/share-workspace-file'

const context = {
  fileId: 'file-1',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const file = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'report.pdf',
}

const activeShare = {
  id: 'share-1',
  resourceType: 'file',
  resourceId: 'file-1',
  token: 'token-1',
  url: 'https://sim.ai/f/token-1',
  isActive: true,
  authType: 'public',
  hasPassword: false,
  allowedEmails: [],
}

describe('unshareWorkspaceFile application service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(context)
    mocks.getFile.mockResolvedValue(file)
    mocks.resolvePermission.mockResolvedValue('admin')
  })

  it('disables an active share and records the transition', async () => {
    const disabledShare = { ...activeShare, isActive: false }
    mocks.getShare.mockResolvedValue(activeShare)
    mocks.upsertShare.mockResolvedValue(disabledShare)

    await expect(
      unshareWorkspaceFile.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).resolves.toEqual({ share: disabledShare, changed: true })

    expect(mocks.upsertShare).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      fileId: 'file-1',
      userId: 'user-1',
      isActive: false,
    })
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FILE_SHARE_DISABLED',
        resourceId: 'file-1',
      })
    )
  })

  it('is idempotent without creating an inactive share or audit entry', async () => {
    mocks.getShare.mockResolvedValue(null)

    await expect(
      unshareWorkspaceFile.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).resolves.toEqual({ share: null, changed: false })

    expect(mocks.upsertShare).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })
})
