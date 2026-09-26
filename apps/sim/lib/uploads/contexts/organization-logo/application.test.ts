import { db } from '@sim/db'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { uploadSessionMock, uploadSessionMockFns } from '@sim/testing/mocks/upload-session.mock'
import { uploadsConfigMock } from '@sim/testing/mocks/uploads-config.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/upload-session/service', () => uploadSessionMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/uploads/config', () => uploadsConfigMock)
vi.mock('@sim/audit', () => auditMock)

import { recordAudit } from '@sim/audit'
import { createInternalFileUploadBodySchema } from '@/lib/api/contracts/upload-sessions'
import {
  authorizeOrganizationLogoControl,
  createOrganizationLogoUpload,
  finalizeOrganizationLogoUpload,
} from '@/lib/uploads/contexts/organization-logo/application'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'

const mocks = {
  create: uploadSessionMockFns.mockCreateUploadSession,
  config: permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization,
}

const principal = createSessionPrincipal()
const input = {
  organizationId: 'org-1',
  name: 'logo.png',
  contentType: 'image/png',
  size: 100,
  localOrigin: 'http://localhost',
}
const key = 'organization-logos/org-1/upload-1-logo.png'
const session = {
  id: 'upload-1',
  purpose: 'organization_logo',
  workspaceId: null,
  userId: 'user-1',
  metadata: {
    organizationLogo: {
      organizationId: 'org-1',
      expectedLogo: null,
      userId: 'user-1',
      sessionId: 'session-1',
    },
  },
  finalKey: key,
  storageKey: key,
  fileName: 'logo.png',
  contentType: 'image/png',
  fileSize: 100,
} as UploadSessionRecord
const request = { headers: new Headers() }

beforeEach(() => {
  resetDbChainMock()
  mocks.config.mockResolvedValue(null)
  dbChainMockFns.limit.mockResolvedValue([{ role: 'admin' }])
})

describe('organization logo uploads', () => {
  it.each([
    ['member', 'forbidden'],
    ['invalid', 'not_found'],
    [undefined, 'not_found'],
  ])('rejects %s before storage is initialized', async (role, code) => {
    dbChainMockFns.limit.mockResolvedValue(role ? [{ role }] : [])
    await expect(createOrganizationLogoUpload(principal, input)).rejects.toMatchObject({ code })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each([createPersonalApiKeyPrincipal(), createWorkspaceApiKeyPrincipal()])(
    'rejects other principal kinds before protected reads',
    async (caller) => {
      await expect(createOrganizationLogoUpload(caller, input)).rejects.toMatchObject({
        code: 'forbidden',
      })
      expect(dbChainMockFns.limit).not.toHaveBeenCalled()
      expect(mocks.create).not.toHaveBeenCalled()
    }
  )

  it.each([
    { ...principal, sessionId: 'other-session' },
    { ...principal, userId: 'other-user' },
  ])('binds all upload controls to the creating credential', async (caller) => {
    await expect(authorizeOrganizationLogoControl(caller, session)).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })

  it('rejects forged workspace scope and missing organization binding', async () => {
    await expect(
      authorizeOrganizationLogoControl(principal, { ...session, workspaceId: 'workspace-1' })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      authorizeOrganizationLogoControl(principal, { ...session, metadata: {} })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })

  it('persists the logo and completion marker in one transaction, with one organization audit', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ role: 'admin' }])
      .mockResolvedValueOnce([{ completedFileId: null, status: 'finalizing' }])
      .mockResolvedValueOnce([{ role: 'admin' }])
      .mockResolvedValueOnce([{ logo: null }])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'org-1', name: 'Test org' }])
      .mockResolvedValueOnce([{ id: 'upload-1' }])
    const first = await finalizeOrganizationLogoUpload(principal, session, request)
    expect(db.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ logo: first.value.path })
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      completedFileId: 'upload-1',
      metadata: { ...session.metadata, organizationLogoPath: first.value.path },
      updatedAt: expect.any(Date),
    })
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'organization.updated',
        resourceType: 'organization',
        resourceId: 'org-1',
        actorId: 'user-1',
        metadata: expect.objectContaining({
          organizationId: 'org-1',
          operation: 'organization.logo.update',
        }),
      })
    )
    dbChainMockFns.set.mockClear()
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ role: 'admin' }])
      .mockResolvedValueOnce([{ completedFileId: 'upload-1', status: 'completed' }])
    expect(await finalizeOrganizationLogoUpload(principal, session, request)).toEqual(first)
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
    expect(recordAudit).toHaveBeenCalledOnce()
  })

  it('rechecks administrator membership under a transaction lock before changing the organization', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ role: 'admin' }])
      .mockResolvedValueOnce([{ completedFileId: null, status: 'finalizing' }])
      .mockResolvedValueOnce([{ role: 'member' }])
    await expect(finalizeOrganizationLogoUpload(principal, session, request)).rejects.toMatchObject(
      { code: 'forbidden' }
    )
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it('rejects an organization deleted before registration without marking or auditing completion', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ role: 'admin' }])
      .mockResolvedValueOnce([{ completedFileId: null, status: 'finalizing' }])
      .mockResolvedValueOnce([{ role: 'admin' }])
      .mockResolvedValueOnce([])
    await expect(finalizeOrganizationLogoUpload(principal, session, request)).rejects.toMatchObject(
      { code: 'not_found' }
    )
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it('rejects an unfinished upload after another session replaces its starting logo', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ role: 'admin' }])
      .mockResolvedValueOnce([{ completedFileId: null, status: 'finalizing' }])
      .mockResolvedValueOnce([{ role: 'admin' }])
      .mockResolvedValueOnce([{ logo: '/api/files/serve/s3/newer-logo.png' }])
    await expect(finalizeOrganizationLogoUpload(principal, session, request)).rejects.toMatchObject(
      {
        code: 'conflict',
      }
    )
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it.each([
    { ...input, purpose: 'organization_logo', organizationId: undefined },
    { ...input, purpose: 'organization_logo', workspaceId: 'workspace-1' },
    { ...input, purpose: 'organization_logo', size: 5 * 1024 * 1024 + 1 },
  ])('rejects invalid organization logo contracts', ({ localOrigin: _localOrigin, ...body }) => {
    expect(createInternalFileUploadBodySchema.safeParse(body).success).toBe(false)
  })
})
