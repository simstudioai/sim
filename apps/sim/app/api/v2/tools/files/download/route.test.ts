/** @vitest-environment node */
import { Readable } from 'node:stream'
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  metadata: vi.fn(),
  permission: vi.fn(),
  download: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.workspace,
}))
vi.mock('@/lib/uploads/server/metadata', () => ({ getFileMetadataByKey: mocks.metadata }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ downloadFileStream: mocks.download }))
vi.mock('@sim/platform-authz/workspace', () => ({
  resolveEffectiveWorkspacePermission: mocks.permission,
  permissionSatisfies: (actual: string | null) => actual !== null,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_DOWNLOADED: 'file_downloaded' },
  AuditResourceType: { FILE: 'file' },
  recordAudit: mocks.audit,
}))

import { GET } from '@/app/api/v2/tools/files/download/route'

const FILE_ID = 'copilot/file-1/report.pdf'
const principal = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' }
const auth = {
  principal,
  rateLimitSubjectIds: ['api-key:key-1'],
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}
const file = {
  id: 'metadata-1',
  key: FILE_ID,
  context: 'copilot',
  originalName: 'report.pdf',
  contentType: 'application/pdf',
  sizeBytes: 3,
  userId: 'user-1',
  workspaceId: null,
  organizationId: null,
  deletedAt: null,
}
function request(query: Record<string, string> = {}, method = 'GET') {
  const params = new URLSearchParams({ workspaceId: 'workspace-1', fileId: FILE_ID, ...query })
  return new NextRequest(`http://localhost/api/v2/tools/files/download?${params}`, { method })
}

describe('authenticated direct tool file download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.workspace.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner',
    })
    mocks.permission.mockResolvedValue('read')
    mocks.metadata.mockResolvedValue(file)
    mocks.download.mockResolvedValue(Readable.from([Buffer.from('pdf')]))
  })

  it('streams canonical owner bytes through the real application authorization and audits the download', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('pdf')
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-length')).toBe('3')
    expect(response.headers.get('content-disposition')).toContain('report.pdf')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(mocks.metadata).toHaveBeenCalledWith(FILE_ID, 'copilot')
    expect(mocks.download).toHaveBeenCalledWith({ key: file.key, context: 'copilot' })
    expect(mocks.audit).toHaveBeenCalledOnce()
  })

  it.each([
    { userId: 'another-user' },
    { userId: 'billing-owner' },
    { workspaceId: 'another-workspace' },
    { organizationId: 'another-org' },
    { context: 'execution' },
    { deletedAt: new Date() },
  ])('conceals unowned, scoped or deleted metadata: %j', async (overrides) => {
    mocks.metadata.mockResolvedValue({ ...file, ...overrides })
    const response = await GET(request())
    expect(response.status).toBe(404)
    expect((await response.json()).error.message).toBe('File not found')
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it.each(['execution/ws/wf/run/file', 'workspace/ws/file', 'https://example.com/file'])(
    'refuses unsupported descriptor %s',
    async (fileId) => {
      expect((await GET(request({ fileId }))).status).toBe(404)
      expect(mocks.metadata).not.toHaveBeenCalled()
      expect(mocks.download).not.toHaveBeenCalled()
    }
  )

  it('conceals revoked workspace access even for the file owner', async () => {
    mocks.permission.mockResolvedValue(null)
    expect((await GET(request())).status).toBe(404)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('refuses a workspace key before metadata loading', async () => {
    v2RouteMocks.authenticate.mockResolvedValue({
      ...auth,
      principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
      keyType: 'workspace',
    })
    const response = await GET(request())
    expect(response.status).toBe(403)
    expect((await response.json()).error.details.code).toBe('WORKSPACE_KEY_OPERATION_NOT_PERMITTED')
    expect(mocks.metadata).not.toHaveBeenCalled()
  })

  it('authenticates before resolving descriptors', async () => {
    v2RouteMocks.authenticate.mockRejectedValue(new MockV2ApiKeyUnauthenticatedError())
    expect((await GET(request())).status).toBe(401)
    expect(mocks.metadata).not.toHaveBeenCalled()
  })

  it('does not accept descriptor claims as authority', async () => {
    expect(
      (await GET(request({ userId: 'another-user', url: 'https://example.com' }))).status
    ).toBe(400)
    expect(mocks.metadata).not.toHaveBeenCalled()
  })

  it('authorizes HEAD without streaming bytes or recording a download', async () => {
    const response = await GET(request({}, 'HEAD'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(mocks.metadata).toHaveBeenCalledOnce()
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it.each(['NoSuchKey', 'BlobNotFound', 'NotFound'])(
    'reports expired storage (%s) as not found',
    async (name) => {
      mocks.download.mockRejectedValue(Object.assign(new Error('expired'), { name }))
      expect((await GET(request())).status).toBe(404)
      expect(mocks.audit).not.toHaveBeenCalled()
    }
  )

  it('keeps infrastructure failures distinct from absent files', async () => {
    mocks.download.mockRejectedValue(new Error('storage unavailable'))
    expect((await GET(request())).status).toBe(500)
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
