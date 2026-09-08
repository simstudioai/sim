/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { PASTE_LIMITS } from '@sim/utils/paste'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadContext: vi.fn(),
  getFile: vi.fn(),
  resolvePermission: vi.fn(),
  download: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null) => actual !== null,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_DOWNLOADED: 'file.downloaded' },
  AuditResourceType: { FILE: 'file' },
  recordAudit: mocks.audit,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  loadActiveWorkspaceFileContext: mocks.loadContext,
  getWorkspaceFile: mocks.getFile,
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({ downloadFile: mocks.download }))

import { exportWorkspaceFileSnapshot } from '@/lib/workspace-files/application/export-workspace-file-snapshot'

const SESSION: Principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }
const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'doc-1'
const file = {
  id: FILE_ID,
  workspaceId: WORKSPACE_ID,
  name: 'notes.md',
  key: 'workspace/workspace-1/durable.md',
  size: 10,
  type: 'text/markdown',
}

function execute(content = 'new unsaved text', principal = SESSION) {
  return exportWorkspaceFileSnapshot.execute({
    principal,
    input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID, content },
  })
}

describe('exportWorkspaceFileSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.loadContext.mockImplementation(async (fileId: string) => ({
      fileId,
      workspaceId: WORKSPACE_ID,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    }))
    mocks.getFile.mockImplementation(async (_workspaceId: string, fileId: string) =>
      fileId === FILE_ID
        ? file
        : {
            ...file,
            id: fileId,
            name: `${fileId}.png`,
            key: `workspace/workspace-1/${fileId}.png`,
            type: 'image/png',
          }
    )
    mocks.download.mockResolvedValue(Buffer.from('image bytes'))
  })

  it.each(['', '---\r\ntitle: Résumé\r\n---\r\n# 你好 😀\r\n', 'not yet persisted'])(
    'exports exact snapshot bytes without reading the persisted document: %j',
    async (content) => {
      const result = await execute(content)

      expect(result.buffer).toEqual(Buffer.from(content))
      expect(result.fileName).toBe('notes.md')
      expect(result.format).toBe('markdown')
      expect(mocks.download).not.toHaveBeenCalled()
      expect(mocks.audit).toHaveBeenCalledOnce()
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          metadata: expect.objectContaining({
            bytes: Buffer.byteLength(content),
            operation: 'files.download',
          }),
        })
      )
    }
  )

  it('bundles and rewrites both image spellings after canonical asset authorization', async () => {
    const result = await execute(
      '![A](/api/files/view/image%2D1)\n<img src="/workspace/workspace-1/files/image-2">'
    )
    const zip = await JSZip.loadAsync(result.buffer)

    expect(result.assetCount).toBe(2)
    expect(await zip.file('notes.md')?.async('string')).toBe(
      '![A](./assets/image-1.png)\n<img src="./assets/image-2.png">'
    )
    expect(await zip.file('assets/image-1.png')?.async('string')).toBe('image bytes')
    expect(mocks.getFile).toHaveBeenCalledWith(WORKSPACE_ID, 'image-1', { throwOnError: true })
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(3)
    expect(mocks.audit).toHaveBeenCalledOnce()
  })

  it('leaves foreign, missing, and inaccessible asset links unchanged without reading their bytes', async () => {
    mocks.loadContext.mockImplementation(async (fileId: string) =>
      fileId === 'missing'
        ? null
        : {
            fileId,
            workspaceId: fileId === 'foreign' ? 'workspace-2' : WORKSPACE_ID,
            workspaceOrganizationId: null,
            allowPersonalApiKeys: true,
          }
    )
    mocks.resolvePermission.mockResolvedValueOnce('read').mockResolvedValue(null)
    const content =
      '![A](/api/files/view/foreign)\n![B](/api/files/view/missing)\n![C](/api/files/view/denied)'

    const result = await execute(content)

    expect(result.buffer.toString()).toBe(content)
    expect(result.assetCount).toBe(0)
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.getFile).toHaveBeenCalledTimes(1)
  })

  it('does not fetch external URLs or ordinary links', async () => {
    const content = '![A](https://example.com/image.png)\n[link](/api/files/view/image-1)'
    expect((await execute(content)).buffer.toString()).toBe(content)
    expect(mocks.loadContext).toHaveBeenCalledTimes(1)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('caps embed resolution at the shared 50-image boundary', async () => {
    const content = Array.from(
      { length: 60 },
      (_, index) => `![A](/api/files/view/image-${index})`
    ).join('\n')
    const result = await execute(content)
    expect(result.assetCount).toBe(50)
    expect(mocks.loadContext).toHaveBeenCalledTimes(51)
    expect(mocks.download).toHaveBeenCalledTimes(50)
  })

  it('rejects revoked root access before reading records or exporting', async () => {
    mocks.resolvePermission.mockResolvedValue(null)
    await expect(execute()).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.getFile).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('conceals a root workspace mismatch before authorization', async () => {
    await expect(
      exportWorkspaceFileSnapshot.execute({
        principal: SESSION,
        input: { fileId: FILE_ID, assertedWorkspaceId: 'workspace-2', content: 'new' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.getFile).not.toHaveBeenCalled()
  })

  it('rejects archived or missing roots without exporting', async () => {
    mocks.loadContext.mockResolvedValue(null)
    await expect(execute()).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('rejects unsupported principals before protected loading', async () => {
    await expect(
      execute('new', {
        kind: 'system',
        serviceId: 'internal',
        workspaceId: WORKSPACE_ID,
        workflowId: 'workflow-1',
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.loadContext).not.toHaveBeenCalled()
  })

  it.each(['application/pdf', 'text/plain'])('rejects non-Markdown root type %s', async (type) => {
    mocks.getFile.mockResolvedValue({ ...file, name: 'document.bin', type })
    await expect(execute()).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('rejects UTF-8 bytes beyond the editor limit before asset resolution', async () => {
    await expect(
      execute('😀'.repeat(Math.floor(PASTE_LIMITS.RICH_MARKDOWN_BYTES / 4) + 1))
    ).rejects.toMatchObject({ code: 'validation', message: 'Markdown snapshot is too large' })
    expect(mocks.loadContext).toHaveBeenCalledTimes(1)
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('propagates asset metadata infrastructure failures without auditing a partial export', async () => {
    const failure = new Error('database unavailable')
    mocks.getFile.mockImplementation(async (_workspaceId: string, fileId: string) => {
      if (fileId === FILE_ID) return file
      throw failure
    })
    await expect(execute('![A](/api/files/view/image-1)')).rejects.toBe(failure)
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('keeps file-scoped delegation from widening to other embedded files', async () => {
    const principal: Principal = {
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      workspaceId: WORKSPACE_ID,
      delegationId: 'delegation-1',
      audience: 'sim:workspace-files',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      resourceScope: { fileId: FILE_ID },
    }
    const content = '![A](/api/files/view/image-1)'
    expect((await execute(content, principal)).buffer.toString()).toBe(content)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('preserves non-human workspace-key audit attribution', async () => {
    await execute('snapshot', {
      kind: 'workspace_api_key',
      keyId: 'key-1',
      workspaceId: WORKSPACE_ID,
    })
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: null, actorName: 'Workspace API key' })
    )
  })

  it.each<Principal>([
    { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
    {
      kind: 'oauth_access_token',
      userId: 'user-1',
      tokenId: 'token-1',
      clientId: 'client-1',
      scopes: ['api:read'],
      expiresAt: new Date(Date.now() + 60_000),
    },
    ...(['copilot', 'executor'] as const).map((serviceId) => ({
      kind: 'delegated' as const,
      serviceId,
      subjectUserId: 'user-1',
      workspaceId: WORKSPACE_ID,
      delegationId: 'delegation-1',
      audience: 'sim:workspace-files',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    })),
  ])('uses current read authorization for registered principal %j', async (principal) => {
    expect((await execute('snapshot', principal)).buffer.toString()).toBe('snapshot')
    expect(mocks.resolvePermission).toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'user-1' }))
  })

  it('rejects expired delegated authority and workspace keys from another tenant', async () => {
    await expect(
      execute('snapshot', {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: WORKSPACE_ID,
        delegationId: 'delegation-1',
        audience: 'sim:workspace-files',
        issuedAt: new Date(0),
        expiresAt: new Date(1),
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      execute('snapshot', {
        kind: 'workspace_api_key',
        workspaceId: 'workspace-2',
        keyId: 'key-2',
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.getFile).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('rejects an OAuth token lacking read scope before loading protected context', async () => {
    await expect(
      execute('snapshot', {
        kind: 'oauth_access_token',
        userId: 'user-1',
        tokenId: 'token-1',
        clientId: 'client-1',
        scopes: [],
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.loadContext).not.toHaveBeenCalled()
  })

  it('propagates canonical root infrastructure failures without auditing', async () => {
    const failure = new Error('database unavailable')
    mocks.loadContext.mockRejectedValue(failure)
    await expect(execute()).rejects.toBe(failure)
    expect(mocks.getFile).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
