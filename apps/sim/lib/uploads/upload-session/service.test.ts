/**
 * @vitest-environment node
 */
import type { Principal, WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { sha256Hex } from '@sim/security/hash'
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { eq, inArray, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAbortProviderUpload,
  mockCheckStorageQuota,
  mockCompleteMultipart,
  mockCreatePutTransfer,
  mockDeleteObjectVersion,
  mockHeadObject,
  mockInitiateMultipart,
  mockListMultipartParts,
  mockResolveBillingContext,
  mockUploadStorageProvider,
} = vi.hoisted(() => ({
  mockAbortProviderUpload: vi.fn(),
  mockCheckStorageQuota: vi.fn(),
  mockCompleteMultipart: vi.fn(),
  mockCreatePutTransfer: vi.fn(),
  mockDeleteObjectVersion: vi.fn(),
  mockHeadObject: vi.fn(),
  mockInitiateMultipart: vi.fn(),
  mockListMultipartParts: vi.fn(),
  mockResolveBillingContext: vi.fn(),
  mockUploadStorageProvider: vi.fn(() => 's3' as const),
}))

vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuotaForBillingContext: mockCheckStorageQuota,
  resolveStorageBillingContext: mockResolveBillingContext,
}))

/**
 * Stands in for the workspace-files barrel, which pulls the whole file manager.
 * The real `generateWorkspaceFileKey` and its name budget are measured in
 * `contexts/workspace/workspace-file-manager.test.ts`, so the purposes that key
 * through it are deliberately absent from the sidecar-bounds sweep below.
 */
vi.mock('@/lib/uploads/contexts/workspace', async () => {
  const { buildStorageKeySegment } = await import('@/lib/uploads/core/storage-key')
  return {
    generateWorkspaceFileKey: vi.fn(
      (workspaceId: string, fileName: string) =>
        `workspace/${workspaceId}/${buildStorageKeySegment('final-', fileName)}`
    ),
  }
})

vi.mock('@/lib/uploads/upload-session/cleanup', () => ({
  maybeCleanupLocalUploadArtifacts: vi.fn().mockResolvedValue({ scanned: 0, removed: 0 }),
}))

vi.mock('@/lib/uploads/upload-session/provider', () => ({
  abortProviderUpload: mockAbortProviderUpload,
  completeMultipartProviderUpload: mockCompleteMultipart,
  createPutProviderTransfer: mockCreatePutTransfer,
  deleteProviderObjectVersion: mockDeleteObjectVersion,
  getMultipartProviderPartUrls: vi.fn(),
  headProviderObject: mockHeadObject,
  initiateMultipartProviderUpload: mockInitiateMultipart,
  listMultipartProviderParts: mockListMultipartParts,
  uploadStorageProvider: mockUploadStorageProvider,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { LOCAL_UPLOAD_METADATA_SUFFIX } from '@/lib/uploads/core/storage-key'
import {
  abortUploadSession,
  assertUploadSessionAuthBinding,
  cleanupExpiredUploadSessions,
  completeUploadSession,
  createUploadPartUrls,
  createUploadSession,
  createUploadSessionAuthBinding,
  expectedUploadPartSize,
  getOwnedUploadSession,
  getPrincipalKnowledgeDocumentUploadSession,
  UPLOAD_SESSION_PART_SIZE,
  UPLOAD_SESSION_PUT_MAX_BYTES,
  type UploadSessionRecord,
  verifyUploadSessionToken,
} from '@/lib/uploads/upload-session/service'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const FINAL_KEY = `workspace/${WORKSPACE_ID}/final-file.bin`
const executorPrincipal: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: WORKSPACE_ID,
  delegationId: 'delegation-1',
  audience: 'sim:tables',
  issuedAt: new Date('2026-08-01T00:00:00.000Z'),
  expiresAt: new Date('2099-08-01T00:00:00.000Z'),
  delegationContext: {
    kind: 'workflow_execution',
    workflowId: 'workflow-1',
    executionId: 'execution-1',
  },
}

describe('upload sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockResolveBillingContext.mockResolvedValue({ workspaceId: WORKSPACE_ID })
    mockCheckStorageQuota.mockResolvedValue({ allowed: true })
    mockUploadStorageProvider.mockReturnValue('s3')
    mockCreatePutTransfer.mockResolvedValue({
      method: 'put',
      url: 'https://storage.example/upload',
      headers: { 'Content-Type': 'application/octet-stream', 'If-None-Match': '*' },
    })
    mockInitiateMultipart.mockResolvedValue({
      provider: 's3',
      providerUploadId: 'provider-upload-1',
    })
  })

  it('persists a hashed token and signs a create-only PUT at the final key', async () => {
    const row = uploadRow({ fileSize: UPLOAD_SESSION_PUT_MAX_BYTES })
    dbChainMockFns.returning.mockResolvedValueOnce([row])

    const created = await createWorkspaceUpload(UPLOAD_SESSION_PUT_MAX_BYTES)

    expect(created).toMatchObject({
      id: 'upload-1',
      method: 'put',
      finalKey: FINAL_KEY,
      storageKey: FINAL_KEY,
      partSize: null,
      partCount: null,
      transfer: { method: 'put' },
    })
    expect(mockInitiateMultipart).not.toHaveBeenCalled()
    expect(mockCreatePutTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ key: FINAL_KEY, uploadId: 'upload-1' })
    )
    const inserted = dbChainMockFns.values.mock.calls[0][0]
    expect(inserted.tokenHash).toBe(sha256Hex(created.uploadToken))
    expect(inserted.tokenHash).not.toBe(created.uploadToken)
    expect(inserted.finalKey).toBe(FINAL_KEY)
    expect(inserted.metadata.authBinding).toEqual({
      version: 1,
      workspaceId: WORKSPACE_ID,
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    })
  })

  // Local storage stores an object's metadata sidecar beside it, under the
  // object's own name, so the whole key + suffix must fit one path component.
  // Three purposes built their key by hand and admitted a 255-character name
  // straight into it: the session was created, its transfer URL issued, and
  // every request against it then failed with an unclassifiable 500.
  it.each([
    ['knowledge_document', { knowledgeBaseId: 'kb-1' }],
    ['table_import', {}],
    ['profile_picture', {}],
    ['workspace_logo', {}],
    ['execution_attachment', { workflowId: 'workflow-1', executionId: 'execution-1' }],
  ])('bounds the %s key so its local sidecar still fits', async (purpose, extra) => {
    dbChainMockFns.returning.mockResolvedValue([uploadRow({ purpose })])

    await createUploadSession({
      id: 'upload-1',
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      purpose: purpose as Parameters<typeof createUploadSession>[0]['purpose'],
      fileName: `${'a'.repeat(251)}.txt`,
      contentType: 'text/plain',
      fileSize: 4,
      localOrigin: 'http://localhost:3000',
      ...extra,
    } as Parameters<typeof createUploadSession>[0])

    const { finalKey } = dbChainMockFns.values.mock.calls[0][0]
    const lastComponent = finalKey.slice(finalKey.lastIndexOf('/') + 1)
    expect(
      Buffer.byteLength(`${lastComponent}${LOCAL_UPLOAD_METADATA_SUFFIX}`, 'utf-8')
    ).toBeLessThanOrEqual(255)
  })

  /**
   * A knowledge document the pipeline provably refuses is rejected on admission
   * whichever route carries it: the direct upload use case rejects a zero-byte
   * buffer, and the session path refuses the same file before it hands out a
   * transfer URL for it. `workspace_file` is the deliberate exception — an empty
   * file is a legitimate thing to keep in a workspace — so pinning both keeps
   * the split a decision rather than an omission.
   */
  it.each([
    ['knowledge_document', { knowledgeBaseId: 'kb-1' }, true],
    ['workspace_file', {}, false],
  ])(
    'admits a zero-byte %s only where an empty file is legitimate',
    async (purpose, extra, refused) => {
      dbChainMockFns.returning.mockResolvedValue([uploadRow({ purpose })])

      const create = createUploadSession({
        id: 'upload-1',
        workspaceId: WORKSPACE_ID,
        userId: 'user-1',
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        purpose: purpose as Parameters<typeof createUploadSession>[0]['purpose'],
        fileName: 'empty.txt',
        contentType: 'text/plain',
        fileSize: 0,
        localOrigin: 'http://localhost:3000',
        ...(extra as object),
      } as Parameters<typeof createUploadSession>[0])

      if (refused) {
        await expect(create).rejects.toThrow('fileSize must be a positive integer')
      } else {
        await expect(create).resolves.toBeDefined()
      }
    }
  )

  it('keeps an OAuth upload bound across access-token rotation for the same client', () => {
    const original: Principal = {
      kind: 'oauth_access_token',
      userId: 'user-1',
      clientId: 'sim-cli',
      tokenId: 'token-1',
      scopes: ['api:write'],
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    }
    const session = sessionRecord({
      purpose: 'knowledge_document',
      knowledgeBaseId: 'kb-1',
      metadata: { authBinding: createUploadSessionAuthBinding(original, WORKSPACE_ID) },
    })
    const rotated: Principal = { ...original, tokenId: 'token-2' }
    const otherClient: Principal = { ...original, clientId: 'other-client', tokenId: 'token-3' }
    const otherUser: Principal = { ...original, userId: 'user-2', tokenId: 'token-4' }

    expect(() => assertUploadSessionAuthBinding(session, rotated)).not.toThrow()
    expect(() => assertUploadSessionAuthBinding(session, otherClient)).toThrow(
      'Upload session not found'
    )
    expect(() => assertUploadSessionAuthBinding(session, otherUser)).toThrow(
      'Upload session not found'
    )
  })

  it('allocates distinct keys for same-named execution attachments', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce([
        uploadRow({
          id: 'upload-1',
          purpose: 'execution_attachment',
          storageContext: 'execution',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        }),
      ])
      .mockResolvedValueOnce([
        uploadRow({
          id: 'upload-2',
          purpose: 'execution_attachment',
          storageContext: 'execution',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        }),
      ])

    const createExecutionAttachment = (id: string) =>
      createUploadSession({
        id,
        workspaceId: WORKSPACE_ID,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        userId: 'user-1',
        purpose: 'execution_attachment',
        fileName: 'output.bin',
        contentType: 'application/octet-stream',
        fileSize: 4,
        localOrigin: 'http://localhost:3000',
      })

    await createExecutionAttachment('upload-1')
    await createExecutionAttachment('upload-2')

    const firstKey = dbChainMockFns.values.mock.calls[0][0].finalKey
    const secondKey = dbChainMockFns.values.mock.calls[1][0].finalKey
    expect(firstKey).not.toBe(secondKey)
    expect(firstKey).toMatch(
      new RegExp(`^execution/${WORKSPACE_ID}/workflow-1/execution-1/[^/]+/upload-1-output\\.bin$`)
    )
    expect(secondKey).toMatch(
      new RegExp(`^execution/${WORKSPACE_ID}/workflow-1/execution-1/[^/]+/upload-2-output\\.bin$`)
    )
  })

  it('rejects workspace control access without the matching immutable credential binding', async () => {
    const row = uploadRow({
      metadata: {
        authBinding: {
          version: 1,
          workspaceId: WORKSPACE_ID,
          principal: { kind: 'workspace_api_key', workspaceId: WORKSPACE_ID, keyId: 'key-1' },
        },
      },
    })
    queueTableRows(schemaMock.uploadSession, [row])

    await expect(
      getOwnedUploadSession({
        uploadId: row.id,
        uploadToken: 'upload-secret',
        principal: { kind: 'workspace_api_key', workspaceId: WORKSPACE_ID, keyId: 'key-2' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('binds new knowledge-document sessions to the exact creating credential', async () => {
    const row = uploadRow({
      purpose: 'knowledge_document',
      knowledgeBaseId: 'kb-1',
      storageContext: 'knowledge-base',
      finalKey: 'kb/guide.pdf',
      fileName: 'guide.pdf',
      contentType: 'application/pdf',
    })
    dbChainMockFns.returning.mockResolvedValueOnce([row])

    await createUploadSession({
      id: row.id,
      workspaceId: WORKSPACE_ID,
      knowledgeBaseId: 'kb-1',
      userId: 'user-1',
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      purpose: 'knowledge_document',
      fileName: 'guide.pdf',
      contentType: 'application/pdf',
      fileSize: 4,
      localOrigin: 'http://localhost:3000',
    })

    expect(dbChainMockFns.values.mock.calls[0][0].metadata.authBinding).toEqual({
      version: 1,
      workspaceId: WORKSPACE_ID,
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
    })
  })

  it('rejects a different API key on a bound knowledge-document control leg', async () => {
    const row = uploadRow({
      purpose: 'knowledge_document',
      knowledgeBaseId: 'kb-1',
      storageContext: 'knowledge-base',
      metadata: {
        authBinding: {
          version: 1,
          workspaceId: WORKSPACE_ID,
          principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
        },
      },
    })
    queueTableRows(schemaMock.uploadSession, [row])

    await expect(
      getPrincipalKnowledgeDocumentUploadSession({
        uploadId: row.id,
        uploadToken: 'upload-secret',
        principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-2' },
        workspaceId: WORKSPACE_ID,
        knowledgeBaseId: 'kb-1',
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it.each([
    {
      label: 'session',
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      mismatch: { kind: 'session', userId: 'user-1', sessionId: 'session-2' },
    },
    {
      label: 'personal API key',
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      mismatch: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-2' },
    },
    {
      label: 'workspace API key',
      principal: {
        kind: 'workspace_api_key',
        workspaceId: WORKSPACE_ID,
        keyId: 'workspace-key-1',
      },
      mismatch: {
        kind: 'workspace_api_key',
        workspaceId: WORKSPACE_ID,
        keyId: 'workspace-key-2',
      },
    },
  ] satisfies Array<{ label: string; principal: Principal; mismatch: Principal }>)(
    'requires the exact bound $label credential for knowledge control',
    ({ principal, mismatch }) => {
      const session = sessionRecord({
        purpose: 'knowledge_document',
        knowledgeBaseId: 'kb-1',
        metadata: { authBinding: createUploadSessionAuthBinding(principal, WORKSPACE_ID) },
      })

      expect(() => assertUploadSessionAuthBinding(session, principal)).not.toThrow()
      expect(() => assertUploadSessionAuthBinding(session, mismatch)).toThrow(
        'Upload session not found'
      )
    }
  )

  it('preserves legacy unbound sessions under their prior ownership rules', () => {
    const legacy = sessionRecord({ metadata: {} })

    expect(() =>
      assertUploadSessionAuthBinding(legacy, {
        kind: 'session',
        userId: legacy.userId,
        sessionId: 'current-session',
      })
    ).not.toThrow()
    expect(() =>
      assertUploadSessionAuthBinding(legacy, {
        kind: 'personal_api_key',
        userId: legacy.userId,
        keyId: 'current-key',
      })
    ).not.toThrow()
    expect(() =>
      assertUploadSessionAuthBinding(legacy, {
        kind: 'workspace_api_key',
        workspaceId: WORKSPACE_ID,
        keyId: 'current-workspace-key',
      })
    ).not.toThrow()

    expect(() =>
      assertUploadSessionAuthBinding(legacy, {
        kind: 'session',
        userId: 'different-user',
        sessionId: 'current-session',
      })
    ).toThrow('Upload session not found')
    expect(() =>
      assertUploadSessionAuthBinding(legacy, {
        kind: 'workspace_api_key',
        workspaceId: 'different-workspace',
        keyId: 'current-workspace-key',
      })
    ).toThrow('Upload session not found')
  })

  it('preserves the explicit missing-binding compatibility path for old knowledge sessions', () => {
    const legacy = sessionRecord({
      purpose: 'knowledge_document',
      knowledgeBaseId: 'kb-1',
      metadata: {},
    })

    expect(() =>
      assertUploadSessionAuthBinding(legacy, {
        kind: 'personal_api_key',
        userId: legacy.userId,
        keyId: 'replacement-key',
      })
    ).not.toThrow()
    expect(() =>
      assertUploadSessionAuthBinding(legacy, {
        kind: 'personal_api_key',
        userId: 'different-user',
        keyId: 'replacement-key',
      })
    ).toThrow('Upload session not found')
  })

  it('never treats a malformed credential binding as a legacy session', () => {
    const malformed = sessionRecord({
      purpose: 'knowledge_document',
      knowledgeBaseId: 'kb-1',
      metadata: { authBinding: { version: 1 } },
    })

    expect(() =>
      assertUploadSessionAuthBinding(malformed, {
        kind: 'session',
        userId: malformed.userId,
        sessionId: 'current-session',
      })
    ).toThrow('Upload session not found')
  })

  it('requires an exact immutable credential binding for table-import control', async () => {
    const bound = uploadRow({
      purpose: 'table_import',
      storageContext: 'table-import',
      metadata: {
        authBinding: {
          version: 1,
          workspaceId: WORKSPACE_ID,
          principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
        },
      },
    })
    queueTableRows(schemaMock.uploadSession, [bound])
    queueTableRows(schemaMock.uploadSession, [bound])

    await expect(
      getOwnedUploadSession({
        uploadId: bound.id,
        uploadToken: 'upload-secret',
        purpose: 'table_import',
        principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      })
    ).resolves.toMatchObject({ id: bound.id, purpose: 'table_import' })
    await expect(
      getOwnedUploadSession({
        uploadId: bound.id,
        uploadToken: 'upload-secret',
        purpose: 'table_import',
        principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-2' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('binds table-import uploads to the canonical executor workflow execution', async () => {
    const row = uploadRow({
      purpose: 'table_import',
      storageContext: 'table-import',
      finalKey: `table-import/${WORKSPACE_ID}/upload-1/people.csv`,
      fileName: 'people.csv',
      contentType: 'text/csv',
    })
    dbChainMockFns.returning.mockResolvedValueOnce([row])

    await createUploadSession({
      id: row.id,
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
      principal: executorPrincipal,
      purpose: 'table_import',
      fileName: 'people.csv',
      contentType: 'text/csv',
      fileSize: 4,
      localOrigin: 'http://localhost:3000',
    })

    expect(dbChainMockFns.values.mock.calls[0][0].metadata.authBinding).toEqual({
      version: 1,
      workspaceId: WORKSPACE_ID,
      principal: {
        kind: 'delegated',
        serviceId: 'executor',
        subjectUserId: 'user-1',
        audience: 'sim:tables',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
    })
  })

  it('accepts refreshed executor tokens only for the same immutable upload binding', () => {
    const session = sessionRecord({
      purpose: 'table_import',
      storageContext: 'table-import',
      metadata: {
        authBinding: createUploadSessionAuthBinding(executorPrincipal, WORKSPACE_ID, {
          executorDelegationAudience: 'sim:tables',
        }),
      },
    })

    expect(() =>
      assertUploadSessionAuthBinding(session, {
        ...executorPrincipal,
        delegationId: 'refreshed-token-jti',
      })
    ).not.toThrow()
    expect(() =>
      assertUploadSessionAuthBinding(session, {
        ...executorPrincipal,
        delegationId: 'other-execution-token',
        delegationContext: {
          kind: 'workflow_execution',
          workflowId: 'workflow-1',
          executionId: 'execution-2',
        },
      })
    ).toThrow('Upload session not found')
    expect(() =>
      assertUploadSessionAuthBinding(session, {
        ...executorPrincipal,
        workspaceId: 'different-workspace',
      })
    ).toThrow('Upload session not found')
  })

  it('does not admit executor delegation outside the explicit Table upload policy', () => {
    expect(() => createUploadSessionAuthBinding(executorPrincipal, WORKSPACE_ID)).toThrow(
      'Delegated principal cannot create this upload'
    )
    expect(() =>
      createUploadSessionAuthBinding(executorPrincipal, WORKSPACE_ID, {
        executorDelegationAudience: 'sim:workspace-files',
      })
    ).toThrow('Delegated principal cannot create this upload')
  })

  it('fails closed for legacy table-import sessions without a binding', () => {
    const legacyImport = sessionRecord({
      purpose: 'table_import',
      storageContext: 'table-import',
      metadata: {},
    })

    expect(() =>
      assertUploadSessionAuthBinding(legacyImport, {
        kind: 'session',
        userId: legacyImport.userId,
        sessionId: 'current-session',
      })
    ).toThrow('Upload session not found')
  })

  it('initiates multipart storage directly at the final key', async () => {
    const fileSize = UPLOAD_SESSION_PUT_MAX_BYTES + 1
    const row = uploadRow({
      fileSize,
      method: 'multipart',
      providerUploadId: 'provider-upload-1',
      partSize: UPLOAD_SESSION_PART_SIZE,
      partCount: Math.ceil(fileSize / UPLOAD_SESSION_PART_SIZE),
    })
    dbChainMockFns.returning.mockResolvedValueOnce([row])

    const created = await createWorkspaceUpload(fileSize)

    expect(created.transfer).toEqual({
      method: 'multipart',
      partSize: UPLOAD_SESSION_PART_SIZE,
      partCount: 7,
    })
    expect(mockInitiateMultipart).toHaveBeenCalledWith(
      expect.objectContaining({ key: FINAL_KEY, uploadId: 'upload-1' })
    )
    expect(mockCreatePutTransfer).not.toHaveBeenCalled()
  })

  it('uses proxy-safe multipart parts for large local uploads', async () => {
    const fileSize = UPLOAD_SESSION_PART_SIZE + 1
    mockUploadStorageProvider.mockReturnValue('local')
    mockInitiateMultipart.mockResolvedValueOnce({ provider: 'local', providerUploadId: null })
    dbChainMockFns.returning.mockResolvedValueOnce([
      uploadRow({
        fileSize,
        method: 'multipart',
        storageProvider: 'local',
        partSize: UPLOAD_SESSION_PART_SIZE,
        partCount: 2,
      }),
    ])

    const created = await createWorkspaceUpload(fileSize)

    expect(created.transfer).toEqual({
      method: 'multipart',
      partSize: UPLOAD_SESSION_PART_SIZE,
      partCount: 2,
    })
    expect(mockCreatePutTransfer).not.toHaveBeenCalled()
  })

  it('preserves multipart request bounds before provider signing', async () => {
    const multipart = sessionRecord({
      method: 'multipart',
      providerUploadId: 'provider-upload-1',
      partSize: UPLOAD_SESSION_PART_SIZE,
      partCount: 2,
      fileSize: UPLOAD_SESSION_PART_SIZE + 1,
    })

    await expect(
      createUploadPartUrls({
        session: multipart,
        partNumbers: [1, 1],
        localOrigin: 'http://localhost:3000',
      })
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(
      createUploadPartUrls({
        session: multipart,
        partNumbers: Array.from({ length: 101 }, (_, index) => index + 1),
        localOrigin: 'http://localhost:3000',
      })
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(
      createUploadPartUrls({
        session: multipart,
        partNumbers: [3],
        localOrigin: 'http://localhost:3000',
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })

  /**
   * The part-number path segment of a signed part URL is caller-editable, so
   * the size lookup is a request boundary. It has to classify an out-of-range
   * part as a validation failure for the data-plane route to answer 400 rather
   * than falling through to its generic 500.
   */
  it('classifies an out-of-range part number as a validation failure', () => {
    const multipart = sessionRecord({
      method: 'multipart',
      partSize: UPLOAD_SESSION_PART_SIZE,
      partCount: 2,
      fileSize: UPLOAD_SESSION_PART_SIZE + 1,
    })

    expect(expectedUploadPartSize(multipart, 1)).toBe(UPLOAD_SESSION_PART_SIZE)
    expect(expectedUploadPartSize(multipart, 2)).toBe(1)
    expect(() => expectedUploadPartSize(multipart, 3)).toThrow(OrchestrationError)
    expect(() => expectedUploadPartSize(multipart, 3)).toThrow('partNumber must be between 1 and 2')
    try {
      expectedUploadPartSize(multipart, 3)
      expect.unreachable('out-of-range part number must throw')
    } catch (error) {
      expect(error).toMatchObject({ code: 'validation' })
    }
  })

  it('loads ownership from PostgreSQL and rejects a mismatched token', async () => {
    const token = 'upload-secret'
    const row = uploadRow({ tokenHash: sha256Hex(token) })
    queueTableRows(schemaMock.uploadSession, [row])
    queueTableRows(schemaMock.uploadSession, [row])
    queueTableRows(schemaMock.uploadSession, [row])

    await expect(
      getOwnedUploadSession({
        uploadId: row.id,
        uploadToken: token,
        userId: row.userId,
        workspaceId: row.workspaceId,
        purpose: row.purpose,
      })
    ).resolves.toMatchObject({ id: row.id, finalKey: row.finalKey })
    await expect(
      getOwnedUploadSession({ uploadId: row.id, uploadToken: 'wrong-token' })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(verifyUploadSessionToken(token)).resolves.toMatchObject({ id: row.id })
  })

  it('completes multipart from the provider part listing without a client manifest', async () => {
    const fileSize = UPLOAD_SESSION_PART_SIZE + 3
    const session = sessionRecord({
      fileSize,
      method: 'multipart',
      providerUploadId: 'provider-upload-1',
      partSize: UPLOAD_SESSION_PART_SIZE,
      partCount: 2,
    })
    const parts = [
      { partNumber: 2, etag: 'etag-2', size: 3 },
      { partNumber: 1, etag: 'etag-1', size: UPLOAD_SESSION_PART_SIZE },
    ]
    mockListMultipartParts.mockResolvedValue(parts)
    mockHeadObject
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(providerObject(session, 'version-1'))
    queueCompletionRows(session, 'version-1')
    const finalize = vi.fn().mockResolvedValue({ value: 'file-1', completedFileId: 'file-1' })

    await expect(completeUploadSession({ session, finalize })).resolves.toMatchObject({
      value: 'file-1',
      alreadyCompleted: false,
      session: { status: 'completed', providerObjectVersion: 'version-1' },
    })
    expect(mockListMultipartParts).toHaveBeenCalledWith(
      expect.objectContaining({ key: FINAL_KEY, providerUploadId: 'provider-upload-1' })
    )
    expect(mockCompleteMultipart).toHaveBeenCalledWith(
      expect.objectContaining({
        key: FINAL_KEY,
        parts: [
          { partNumber: 1, etag: 'etag-1', size: UPLOAD_SESSION_PART_SIZE },
          { partNumber: 2, etag: 'etag-2', size: 3 },
        ],
      })
    )
    expect(finalize).toHaveBeenCalledOnce()
  })

  it('rejects missing or incorrectly sized provider parts before completion', async () => {
    const session = sessionRecord({
      fileSize: UPLOAD_SESSION_PART_SIZE + 3,
      method: 'multipart',
      providerUploadId: 'provider-upload-1',
      partSize: UPLOAD_SESSION_PART_SIZE,
      partCount: 2,
    })
    mockHeadObject.mockResolvedValueOnce(null)
    mockListMultipartParts.mockResolvedValueOnce([
      { partNumber: 1, etag: 'etag-1', size: UPLOAD_SESSION_PART_SIZE - 1 },
      { partNumber: 2, etag: 'etag-2', size: 4 },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      uploadRow({ ...rowGeometry(session), status: 'completing' }),
    ])

    await expect(completeUploadSession({ session, finalize: vi.fn() })).rejects.toThrow(
      `Provider part 1 has ${UPLOAD_SESSION_PART_SIZE - 1} bytes`
    )
    expect(mockCompleteMultipart).not.toHaveBeenCalled()
  })

  it('verifies an uploaded PUT object and retains it when domain finalization fails', async () => {
    const session = sessionRecord()
    mockHeadObject.mockResolvedValue(providerObject(session, 'version-1'))
    dbChainMockFns.returning
      .mockResolvedValueOnce([uploadRow({ status: 'completing' })])
      .mockResolvedValueOnce([
        uploadRow({ status: 'finalizing', providerObjectVersion: 'version-1' }),
      ])
    const finalize = vi.fn().mockRejectedValue(new Error('domain unavailable'))

    await expect(completeUploadSession({ session, finalize })).rejects.toThrow('domain unavailable')
    expect(mockDeleteObjectVersion).not.toHaveBeenCalled()
    expect(mockAbortProviderUpload).not.toHaveBeenCalled()
    expect(mockCompleteMultipart).not.toHaveBeenCalled()
  })

  it('allows a finalizing session to recover after its upload TTL', async () => {
    const session = sessionRecord({
      status: 'finalizing',
      expiresAt: new Date(Date.now() - 1),
      providerObjectVersion: 'version-1',
    })
    mockHeadObject.mockResolvedValue(providerObject(session, 'version-1'))
    queueCompletionRows(session, 'version-1')

    await expect(
      completeUploadSession({
        session,
        finalize: async () => ({ value: 'recovered', completedFileId: 'file-1' }),
      })
    ).resolves.toMatchObject({ value: 'recovered', alreadyCompleted: true })
  })

  it('loads a durable finalizing result without re-running the finalizer', async () => {
    const session = sessionRecord({
      status: 'finalizing',
      expiresAt: new Date(Date.now() - 1),
      providerObjectVersion: 'version-1',
      completedFileId: 'file-1',
    })
    dbChainMockFns.returning
      .mockResolvedValueOnce([
        uploadRow({
          ...rowGeometry(session),
          status: 'finalizing',
          completedFileId: 'file-1',
        }),
      ])
      .mockResolvedValueOnce([
        uploadRow({
          ...rowGeometry(session),
          status: 'completed',
          completedFileId: 'file-1',
          completedAt: new Date(),
        }),
      ])
    const finalize = vi.fn()
    const loadCompleted = vi.fn().mockResolvedValue('recovered-file')

    await expect(
      completeUploadSession({ session, finalize, loadCompleted })
    ).resolves.toMatchObject({ value: 'recovered-file', alreadyCompleted: true })
    expect(loadCompleted).toHaveBeenCalledOnce()
    expect(finalize).not.toHaveBeenCalled()
    expect(mockHeadObject).not.toHaveBeenCalled()
  })

  it('loads an already-completed durable result without re-running the finalizer', async () => {
    const session = sessionRecord({ status: 'completed', completedFileId: 'file-1' })
    const finalize = vi.fn()
    const loadCompleted = vi.fn().mockResolvedValue('completed-file')

    await expect(
      completeUploadSession({ session, finalize, loadCompleted })
    ).resolves.toMatchObject({ value: 'completed-file', alreadyCompleted: true })
    expect(loadCompleted).toHaveBeenCalledOnce()
    expect(finalize).not.toHaveBeenCalled()
  })

  it('deletes a matching completed provider object without aborting its consumed upload id', async () => {
    const session = sessionRecord({
      method: 'multipart',
      providerUploadId: 'provider-upload-1',
      fileSize: UPLOAD_SESSION_PART_SIZE + 1,
      partSize: UPLOAD_SESSION_PART_SIZE,
      partCount: 2,
    })
    mockHeadObject.mockResolvedValue(providerObject(session, 'version-1'))
    dbChainMockFns.returning
      .mockResolvedValueOnce([uploadRow({ ...rowGeometry(session), status: 'aborting' })])
      .mockResolvedValueOnce([
        uploadRow({ ...rowGeometry(session), status: 'aborted', completedAt: new Date() }),
      ])

    await expect(abortUploadSession(session)).resolves.toMatchObject({ status: 'aborted' })
    expect(mockAbortProviderUpload).not.toHaveBeenCalled()
    expect(mockDeleteObjectVersion).toHaveBeenCalledWith({
      provider: 's3',
      key: FINAL_KEY,
      version: 'version-1',
      context: 'workspace',
    })
  })

  it('aborts multipart provider state when no final object exists', async () => {
    const session = sessionRecord({
      method: 'multipart',
      providerUploadId: 'provider-upload-1',
      fileSize: UPLOAD_SESSION_PART_SIZE + 1,
      partSize: UPLOAD_SESSION_PART_SIZE,
      partCount: 2,
    })
    mockHeadObject.mockResolvedValue(null)
    dbChainMockFns.returning
      .mockResolvedValueOnce([uploadRow({ ...rowGeometry(session), status: 'aborting' })])
      .mockResolvedValueOnce([
        uploadRow({ ...rowGeometry(session), status: 'aborted', completedAt: new Date() }),
      ])

    await expect(abortUploadSession(session)).resolves.toMatchObject({ status: 'aborted' })
    expect(mockAbortProviderUpload).toHaveBeenCalledWith(
      expect.objectContaining({ key: FINAL_KEY, providerUploadId: 'provider-upload-1' })
    )
    expect(mockDeleteObjectVersion).not.toHaveBeenCalled()
  })

  it('refuses to abort once domain finalization has registered a resource', async () => {
    const session = sessionRecord({ status: 'finalizing', completedFileId: 'file-1' })

    await expect(abortUploadSession(session)).rejects.toThrow(
      'Finalizing upload sessions with a registered file cannot be aborted'
    )
    expect(mockAbortProviderUpload).not.toHaveBeenCalled()
    expect(mockDeleteObjectVersion).not.toHaveBeenCalled()
  })

  it('aborts a finalizing session whose durable registration never committed', async () => {
    const session = sessionRecord({
      status: 'finalizing',
      providerObjectVersion: 'version-1',
      completedFileId: null,
    })
    mockHeadObject.mockResolvedValue(providerObject(session, 'version-1'))
    dbChainMockFns.returning
      .mockResolvedValueOnce([
        uploadRow({
          ...rowGeometry(session),
          status: 'aborting',
          providerObjectVersion: 'version-1',
        }),
      ])
      .mockResolvedValueOnce([
        uploadRow({
          ...rowGeometry(session),
          status: 'aborted',
          providerObjectVersion: 'version-1',
          completedAt: new Date(),
        }),
      ])

    await expect(abortUploadSession(session)).resolves.toMatchObject({ status: 'aborted' })
    expect(mockDeleteObjectVersion).toHaveBeenCalledWith(
      expect.objectContaining({ key: FINAL_KEY, version: 'version-1' })
    )
  })

  it('cleans expired upload state including unregistered finalizing sessions', async () => {
    const expired = uploadRow({ expiresAt: new Date(Date.now() - 1) })
    queueTableRows(schemaMock.uploadSession, [expired])
    queueTableRows(schemaMock.uploadSession, [])
    mockHeadObject.mockResolvedValue(providerObject(sessionRecord(), 'version-1'))
    dbChainMockFns.returning
      .mockResolvedValueOnce([uploadRow({ status: 'aborting', expiresAt: expired.expiresAt })])
      .mockResolvedValueOnce([{ id: 'upload-1' }])

    await expect(cleanupExpiredUploadSessions()).resolves.toEqual({
      expired: 1,
      failed: 0,
      purged: 0,
    })
    expect(mockDeleteObjectVersion).toHaveBeenCalledWith(
      expect.objectContaining({ key: FINAL_KEY, version: 'version-1' })
    )
    const candidateStatuses = vi
      .mocked(inArray)
      .mock.calls.find(([, values]) => values.includes('uploading'))?.[1]
    expect(candidateStatuses).toEqual(['uploading', 'completing', 'aborting'])
    expect(vi.mocked(eq)).toHaveBeenCalledWith(schemaMock.uploadSession.status, 'finalizing')
    expect(vi.mocked(isNull)).toHaveBeenCalledWith(schemaMock.uploadSession.completedFileId)
  })

  it('deletes a late PUT object before purging an aborted session', async () => {
    const completedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    const aborted = uploadRow({ status: 'aborted', completedAt })
    queueTableRows(schemaMock.uploadSession, [])
    queueTableRows(schemaMock.uploadSession, [aborted])
    mockHeadObject.mockResolvedValue(providerObject(sessionRecord(aborted), 'version-1'))
    dbChainMockFns.returning
      .mockResolvedValueOnce([aborted])
      .mockResolvedValueOnce([{ id: aborted.id }])

    await expect(cleanupExpiredUploadSessions()).resolves.toEqual({
      expired: 0,
      failed: 0,
      purged: 1,
    })
    expect(mockDeleteObjectVersion).toHaveBeenCalledWith(
      expect.objectContaining({ key: FINAL_KEY, version: 'version-1' })
    )
  })
})

async function createWorkspaceUpload(fileSize: number) {
  return createUploadSession({
    id: 'upload-1',
    workspaceId: WORKSPACE_ID,
    userId: 'user-1',
    principal: {
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    },
    purpose: 'workspace_file',
    fileName: 'file.bin',
    contentType: 'application/octet-stream',
    fileSize,
    localOrigin: 'http://localhost:3000',
  })
}

function sessionRecord(overrides: Partial<UploadSessionRecord> = {}): UploadSessionRecord {
  const row = uploadRow(overrides)
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    knowledgeBaseId: row.knowledgeBaseId,
    workflowId: row.workflowId,
    executionId: row.executionId,
    purpose: row.purpose,
    method: row.method,
    storageContext: 'workspace',
    storageKey: row.finalKey,
    finalKey: row.finalKey,
    storageProvider: row.storageProvider,
    providerUploadId: row.providerUploadId,
    providerObjectVersion: row.providerObjectVersion,
    fileName: row.fileName,
    contentType: row.contentType,
    fileSize: row.fileSize,
    partSize: row.partSize,
    partCount: row.partCount,
    status: row.status,
    metadata: row.metadata,
    uploadToken: 'upload-secret',
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    completedFileId: row.completedFileId,
    error: row.error,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  }
}

function uploadRow(overrides: Record<string, unknown> = {}) {
  const now = new Date()
  return {
    id: 'upload-1',
    tokenHash: sha256Hex('upload-secret'),
    userId: 'user-1',
    workspaceId: WORKSPACE_ID,
    knowledgeBaseId: null,
    workflowId: null,
    executionId: null,
    purpose: 'workspace_file' as const,
    method: 'put' as const,
    storageContext: 'workspace',
    finalKey: FINAL_KEY,
    storageProvider: 's3' as const,
    providerUploadId: null,
    providerObjectVersion: null,
    fileName: 'file.bin',
    contentType: 'application/octet-stream',
    fileSize: 4,
    partSize: null,
    partCount: null,
    status: 'uploading' as const,
    metadata: {},
    processingLeaseId: null,
    processingLeaseExpiresAt: null,
    completedFileId: null,
    error: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    completedAt: null,
    updatedAt: now,
    ...overrides,
  }
}

function rowGeometry(session: UploadSessionRecord): Record<string, unknown> {
  return {
    method: session.method,
    providerUploadId: session.providerUploadId,
    providerObjectVersion: session.providerObjectVersion,
    fileSize: session.fileSize,
    partSize: session.partSize,
    partCount: session.partCount,
    expiresAt: session.expiresAt,
  }
}

function queueCompletionRows(session: UploadSessionRecord, version: string): void {
  dbChainMockFns.returning
    .mockResolvedValueOnce([
      uploadRow({
        ...rowGeometry(session),
        status: session.status === 'finalizing' ? 'finalizing' : 'completing',
      }),
    ])
    .mockResolvedValueOnce([
      uploadRow({
        ...rowGeometry(session),
        status: 'finalizing',
        providerObjectVersion: version,
      }),
    ])
    .mockResolvedValueOnce([
      uploadRow({
        ...rowGeometry(session),
        status: 'completed',
        providerObjectVersion: version,
        completedFileId: 'file-1',
        completedAt: new Date(),
      }),
    ])
}

function providerObject(session: UploadSessionRecord, version: string) {
  return {
    size: session.fileSize,
    contentType: session.contentType,
    uploadId: session.id,
    version,
  }
}
