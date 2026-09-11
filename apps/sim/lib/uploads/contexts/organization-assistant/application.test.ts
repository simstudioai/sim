/** @vitest-environment node */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import sharp from 'sharp'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ download: vi.fn(), config: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ downloadFile: mocks.download }))
vi.mock('@/lib/uploads/upload-session/service', () => ({ createUploadSession: mocks.create }))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))
vi.mock('@/lib/uploads/config', () => ({ getServeStoragePrefix: () => 's3' }))

import {
  authorizeOrganizationAttachmentControl,
  createOrganizationAssistantAttachment,
  finalizeOrganizationAssistantAttachment,
  readOrganizationAssistantImage,
} from '@/lib/uploads/contexts/organization-assistant/application'
import { ASSISTANT_IMAGE_MAX_BYTES } from '@/lib/uploads/shared/assistant-images'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'

const principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const
const key = 'assistant/org-1/user-1/upload-1/image.png'
const session: UploadSessionRecord = {
  id: 'upload-1',
  purpose: 'mothership_attachment',
  workspaceId: null,
  userId: 'user-1',
  metadata: {
    organizationAttachment: { organizationId: 'org-1', userId: 'user-1', sessionId: 'session-1' },
  },
  finalKey: key,
  storageKey: key,
  fileName: 'image.png',
  contentType: 'image/png',
  fileSize: 100,
  storageContext: 'mothership',
  storageProvider: 's3',
  status: 'completed',
  method: 'put',
  knowledgeBaseId: null,
  workflowId: null,
  executionId: null,
  providerUploadId: null,
  providerObjectVersion: 'v1',
  partSize: null,
  partCount: null,
  uploadToken: '',
  createdAt: new Date(),
  expiresAt: new Date(),
  completedFileId: null,
  error: null,
  completedAt: new Date(),
  updatedAt: new Date(),
}
let png: Buffer
beforeAll(async () => {
  png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ff0000' } })
    .png()
    .toBuffer()
})
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.config.mockResolvedValue(null)
  mocks.download.mockResolvedValue(png)
  dbChainMockFns.limit.mockResolvedValue([{ role: 'member' }])
})

function read(overrides: Partial<Parameters<typeof readOrganizationAssistantImage>[0]> = {}) {
  return readOrganizationAssistantImage({ principal, organizationId: 'org-1', key, ...overrides })
}

describe('private organization Assistant images', () => {
  it('creates uploads as the actual current member with no workspace fallback', async () => {
    await createOrganizationAssistantAttachment(principal, {
      organizationId: 'org-1',
      name: 'image.png',
      contentType: 'image/png',
      size: 100,
      localOrigin: 'http://localhost',
    })
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        userId: 'user-1',
        organizationId: 'org-1',
        purpose: 'mothership_attachment',
      })
    )
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('workspaceId')
  })

  it('rejects removed members before creating an upload', async () => {
    dbChainMockFns.limit.mockResolvedValue([])
    await expect(
      createOrganizationAssistantAttachment(principal, {
        organizationId: 'org-1',
        name: 'image.png',
        contentType: 'image/png',
        size: 100,
        localOrigin: 'http://localhost',
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('reads canonical completed uploads after a new login and emits bounded decoded bytes', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([session])
    const signal = new AbortController().signal
    const image = await read({ principal: { ...principal, sessionId: 'new-session' }, signal })
    expect(image).toMatchObject({
      id: 'upload-1',
      key,
      name: 'image.png',
      contentType: 'image/webp',
    })
    expect((await sharp(image.buffer).metadata()).format).toBe('webp')
    expect(mocks.download).toHaveBeenCalledWith({
      key,
      context: 'mothership',
      maxBytes: ASSISTANT_IMAGE_MAX_BYTES,
      signal,
    })
  })

  it.each([
    { key: 'https://example.com/image.png' },
    { key: 'assistant/org-1/user-1/../image.png' },
    { principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' } as const },
  ])('rejects invalid references or non-session callers before loading', async (input) => {
    await expect(read(input)).rejects.toMatchObject({ code: 'not_found' })
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it.each([
    { organizationId: 'other-org' },
    { principal: { ...principal, userId: 'other-user' } },
    { key: 'assistant/other-org/user-1/upload-1/image.png' },
  ])('rejects a mismatched asserted owner', async (input) => {
    dbChainMockFns.limit.mockResolvedValueOnce([session])
    await expect(read(input)).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('refuses absent, incomplete, or purged records', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(read()).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('rechecks membership for every preview/model read', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([session]).mockResolvedValueOnce([])
    await expect(read()).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('rejects missing immutable scope metadata', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...session, metadata: {} }])
    await expect(read()).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('refuses metadata above the byte cap without downloading', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { ...session, fileSize: ASSISTANT_IMAGE_MAX_BYTES + 1 },
    ])
    await expect(read()).rejects.toMatchObject({ code: 'payload_too_large' })
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it.each([
    '<html><script>alert(1)</script></html>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" /></svg>',
  ])('rejects active content with a forged image MIME', async (content) => {
    dbChainMockFns.limit.mockResolvedValueOnce([session])
    mocks.download.mockResolvedValue(Buffer.from(content))
    await expect(read()).rejects.toMatchObject({ code: 'validation' })
  })

  it('propagates storage infrastructure failures unchanged', async () => {
    const error = new Error('storage unavailable')
    dbChainMockFns.limit.mockResolvedValueOnce([session])
    mocks.download.mockRejectedValue(error)
    await expect(read()).rejects.toBe(error)
  })

  it('rejects compressed images above the 25 megapixel decode budget', async () => {
    const largePng = await sharp({
      create: { width: 5001, height: 5000, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer()
    expect(largePng.length).toBeLessThan(ASSISTANT_IMAGE_MAX_BYTES)
    dbChainMockFns.limit.mockResolvedValueOnce([session])
    mocks.download.mockResolvedValue(largePng)
    await expect(read()).rejects.toMatchObject({ code: 'validation', cause: expect.any(Error) })
  })

  it('binds upload controls to the exact creating session', async () => {
    await expect(
      authorizeOrganizationAttachmentControl({ ...principal, sessionId: 'other-session' }, session)
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })

  it('reauthorizes finalization after decoding before returning an attachment', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ role: 'member' }]).mockResolvedValueOnce([])
    await expect(finalizeOrganizationAssistantAttachment(principal, session)).rejects.toMatchObject(
      { code: 'not_found' }
    )
    expect(mocks.download).toHaveBeenCalledTimes(1)
  })

  it('returns the same durable metadata on completion replay', async () => {
    const first = await finalizeOrganizationAssistantAttachment(principal, session)
    const second = await finalizeOrganizationAssistantAttachment(principal, session)
    expect(second).toEqual(first)
    expect(first).toMatchObject({
      key,
      path: `/api/files/serve/s3/${encodeURIComponent(key)}?context=mothership`,
    })
  })
})
