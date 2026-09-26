/**
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
import { billingStorageMock } from '@sim/testing/mocks/billing-storage.mock'
import { storageServiceMock } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock, uploadsMockFns } from '@sim/testing/mocks/uploads.mock'
import {
  workspaceFileFoldersMock,
  workspaceFileFoldersMockFns,
} from '@sim/testing/mocks/workspace-file-folders.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/storage', () => billingStorageMock)

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-versions', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/uploads/contexts/workspace/workspace-file-versions')
  >()),
  currentWorkspaceFileVersionNumberSql: vi.fn(() => ({ versionProjection: true })),
}))

vi.mock('@/lib/uploads', () => uploadsMock)

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-folder-manager',
  () => workspaceFileFoldersMock
)

import {
  listWorkspaceFiles,
  parseChatUploadReference,
  resolveWorkspaceFileReference,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

uploadsMockFns.mockGetServePathPrefix.mockImplementation(() => '/api/files/serve/s3/')
workspaceFileFoldersMockFns.mockFindWorkspaceFileFolderIdByPath.mockResolvedValue(null)

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

  it('reaches a chat upload by its own id only on opt-in', async () => {
    queueTableRows(schemaMock.workspaceFiles, [{ file: chatUploadRow(), currentVersion: 7 }])

    const record = await resolveWorkspaceFileReference(WS, 'wf_upload', {
      includeChatUploads: true,
    })

    expect(record).toMatchObject({
      id: 'wf_upload',
      name: 'face (2).png',
      vfsNamespace: 'uploads',
      currentVersion: 7,
    })
    expect(lastConditions()).toContainEqual(
      expect.objectContaining({
        type: 'inArray',
        column: schemaMock.workspaceFiles.context,
        values: ['workspace', 'mothership'],
      })
    )
  })

  it.each([
    ['6076afcc-31eb-426a-831b-254bce6670fb', 'face.png', 'image/png'],
    ['7176afcc-31eb-426a-831b-254bce6670fb', 'notes.txt', 'text/plain'],
  ])('resolves UUID upload %s directly with opt-in', async (id, name, contentType) => {
    queueTableRows(schemaMock.workspaceFiles, [
      {
        file: chatUploadRow({ id, originalName: name, displayName: name, contentType }),
        currentVersion: 1,
      },
    ])

    const record = await resolveWorkspaceFileReference(WS, id, { includeChatUploads: true })

    expect(record).toMatchObject({ id, name, type: contentType, vfsNamespace: 'uploads' })
    expect(lastConditions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'eq', left: schemaMock.workspaceFiles.id, right: id }),
        expect.objectContaining({
          type: 'eq',
          left: schemaMock.workspaceFiles.workspaceId,
          right: WS,
        }),
        expect.objectContaining({ type: 'isNull', column: schemaMock.workspaceFiles.deletedAt }),
        expect.objectContaining({
          type: 'inArray',
          column: schemaMock.workspaceFiles.context,
          values: ['workspace', 'mothership'],
        }),
      ])
    )
    expect(dbChainMockFns.from).toHaveBeenCalledTimes(1)
  })

  it('excludes chat uploads from UUID lookup without opt-in', async () => {
    const id = '6076afcc-31eb-426a-831b-254bce6670fb'
    queueTableRows(schemaMock.workspaceFiles, [])

    await expect(resolveWorkspaceFileReference(WS, id)).resolves.toBeNull()

    const firstConditions = flattenMockConditions(dbChainMockFns.where.mock.calls[0]?.[0])
    expect(firstConditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'eq', left: schemaMock.workspaceFiles.id, right: id }),
        expect.objectContaining({
          type: 'eq',
          left: schemaMock.workspaceFiles.workspaceId,
          right: WS,
        }),
        expect.objectContaining({
          type: 'eq',
          left: schemaMock.workspaceFiles.context,
          right: 'workspace',
        }),
      ])
    )
    expect(
      allConditions().some(
        (condition) => condition.type === 'inArray' || condition.right === 'mothership'
      )
    ).toBe(false)
  })
})

describe('listWorkspaceFiles', () => {
  beforeEach(() => {
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
