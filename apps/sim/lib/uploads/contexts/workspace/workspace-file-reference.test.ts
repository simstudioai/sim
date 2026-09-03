/**
 * @vitest-environment node
 *
 * `resolveWorkspaceFileReference` and the chat-upload namespace. Chat uploads
 * (`context = 'mothership'`) are hidden from every listing on purpose, so the
 * only way to one is an explicit `uploads/<name>` reference (or its own id)
 * under a read that opts in. These assertions pin both halves: the opt-in
 * reaches the upload through its own query, and without it nothing does.
 */
import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/storage', () => ({
  decrementStorageUsageForBillingContextInTx: vi.fn(),
  incrementStorageUsageForBillingContextInTx: vi.fn(),
  maybeNotifyStorageLimitForBillingContext: vi.fn(),
  resolveStorageBillingContext: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  getServePathPrefix: vi.fn(() => '/api/files/serve/s3/'),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
  hasCloudStorage: vi.fn(() => false),
  headObject: vi.fn(),
  uploadFile: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  assertWorkspaceFileFolderTarget: vi.fn(async () => null),
  buildWorkspaceFileFolderPathMap: vi.fn(() => new Map()),
  fileNameExistsInWorkspaceFolder: vi.fn(async () => false),
  findWorkspaceFileFolderIdByPath: vi.fn(async () => null),
  getWorkspaceFileFolderPath: vi.fn(),
  listWorkspaceFileFolders: vi.fn(async () => []),
  normalizeWorkspaceFileItemName: vi.fn((name: string) => name),
  resolveWorkspaceFileFolderTarget: vi.fn(async () => null),
}))

import {
  getSandboxWorkspaceFilePath,
  listWorkspaceFiles,
  parseChatUploadReference,
  resolveWorkspaceFileReference,
  workspaceFileVfsPath,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const WS = '22222222-2222-2222-2222-222222222222'
const UPLOAD_KEY = `workspace/${WS}/1731000000000-ab12cd34-face.png`

function chatUploadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf_upload',
    key: UPLOAD_KEY,
    userId: 'user-1',
    workspaceId: WS,
    folderId: null,
    context: 'mothership',
    chatId: '11111111-1111-1111-1111-111111111111',
    messageId: 'msg-1',
    originalName: 'face.png',
    displayName: 'face (2).png',
    contentType: 'image/png',
    size: 10,
    sizeBytes: 10,
    width: null,
    height: null,
    deletedAt: null,
    uploadedAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    contentUpdatedAt: new Date('2026-09-01T00:00:00Z'),
    secretProvenanceVersion: null,
    ...overrides,
  }
}

const allConditions = () =>
  dbChainMockFns.where.mock.calls.flatMap(([condition]) => flattenMockConditions(condition))

const lastConditions = () =>
  flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0]).filter(Boolean)

describe('parseChatUploadReference', () => {
  it.each([
    ['uploads/face.png', 'face.png'],
    ['/uploads/face%20(2).png', 'face (2).png'],
    ['uploads/a/b.png', null],
    ['files/uploads/face.png', null],
    ['files/face.png', null],
    ['wf_upload', null],
  ])('%s → %s', (reference, expected) => {
    expect(parseChatUploadReference(reference)).toBe(expected)
  })
})

describe('resolveWorkspaceFileReference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('resolves uploads/<name> to the newest chat upload when a read opts in', async () => {
    queueTableRows(schemaMock.workspaceFiles, [chatUploadRow()])

    const record = await resolveWorkspaceFileReference(WS, 'uploads/face%20(2).png', {
      includeChatUploads: true,
    })

    expect(record).toMatchObject({
      id: 'wf_upload',
      name: 'face (2).png',
      folderId: null,
      folderPath: null,
      storageContext: 'mothership',
      vfsNamespace: 'uploads',
      path: `/api/files/serve/s3/${encodeURIComponent(UPLOAD_KEY)}?context=mothership`,
    })

    const conditions = lastConditions()
    expect(conditions).toContainEqual(
      expect.objectContaining({
        type: 'eq',
        left: schemaMock.workspaceFiles.context,
        right: 'mothership',
      })
    )
    expect(conditions).toContainEqual(
      expect.objectContaining({ type: 'isNull', column: schemaMock.workspaceFiles.deletedAt })
    )
    const nameMatch = conditions.find((condition) => condition.type === 'or')
    expect(nameMatch).toMatchObject({
      conditions: [
        { type: 'eq', left: schemaMock.workspaceFiles.displayName, right: 'face (2).png' },
        expect.anything(),
      ],
    })
    expect(dbChainMockFns.orderBy).toHaveBeenCalledWith({
      type: 'desc',
      column: schemaMock.workspaceFiles.uploadedAt,
    })
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
    /** Found by its own query: the listing fallback never ran. */
    expect(dbChainMockFns.from).toHaveBeenCalledTimes(1)
  })

  it('never consults chat uploads without the opt-in', async () => {
    queueTableRows(schemaMock.workspaceFiles, [])

    await expect(resolveWorkspaceFileReference(WS, 'uploads/face.png')).resolves.toBeNull()

    const conditions = allConditions()
    expect(conditions.some((condition) => condition.right === 'mothership')).toBe(false)
    expect(conditions.some((condition) => condition.type === 'inArray')).toBe(false)
    expect(conditions).toContainEqual(
      expect.objectContaining({
        type: 'eq',
        left: schemaMock.workspaceFiles.context,
        right: 'workspace',
      })
    )
  })

  it('falls through to workspace files when no chat upload carries the name', async () => {
    queueTableRows(schemaMock.workspaceFiles, [])
    queueTableRows(schemaMock.workspaceFiles, [])

    await expect(
      resolveWorkspaceFileReference(WS, 'uploads/report.csv', { includeChatUploads: true })
    ).resolves.toBeNull()

    expect(dbChainMockFns.from).toHaveBeenCalledTimes(2)
  })

  it('reaches a chat upload by its own id only on opt-in', async () => {
    queueTableRows(schemaMock.workspaceFiles, [chatUploadRow()])

    const record = await resolveWorkspaceFileReference(WS, 'wf_upload', {
      includeChatUploads: true,
    })

    expect(record).toMatchObject({ id: 'wf_upload', name: 'face (2).png', vfsNamespace: 'uploads' })
    expect(lastConditions()).toContainEqual(
      expect.objectContaining({
        type: 'inArray',
        column: schemaMock.workspaceFiles.context,
        values: ['workspace', 'mothership'],
      })
    )
  })

  it('keeps id lookups on workspace files by default', async () => {
    queueTableRows(schemaMock.workspaceFiles, [])
    queueTableRows(schemaMock.workspaceFiles, [])

    await resolveWorkspaceFileReference(WS, 'wf_upload')

    const conditions = allConditions()
    expect(conditions.some((condition) => condition.type === 'inArray')).toBe(false)
    expect(conditions).toContainEqual(
      expect.objectContaining({
        type: 'eq',
        left: schemaMock.workspaceFiles.context,
        right: 'workspace',
      })
    )
  })
})

describe('listWorkspaceFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('lists workspace files only, so a chat upload is never enumerable', async () => {
    queueTableRows(schemaMock.workspaceFiles, [])

    await listWorkspaceFiles(WS)

    expect(lastConditions()).toContainEqual(
      expect.objectContaining({
        type: 'eq',
        left: schemaMock.workspaceFiles.context,
        right: 'workspace',
      })
    )
  })
})

describe('workspace file VFS paths', () => {
  it('addresses a chat upload under uploads/ and mounts it there', () => {
    const upload = { folderPath: null, name: 'face (2).png', vfsNamespace: 'uploads' as const }

    expect(workspaceFileVfsPath(upload)).toBe('uploads/face%20(2).png')
    expect(getSandboxWorkspaceFilePath(upload)).toBe('/home/user/uploads/face%20(2).png')
  })

  it('keeps workspace files under files/', () => {
    const file = { folderPath: 'Reports', name: 'data.csv' }

    expect(workspaceFileVfsPath(file)).toBe('files/Reports/data.csv')
    expect(getSandboxWorkspaceFilePath(file)).toBe('/home/user/files/Reports/data.csv')
  })
})
