/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  create: vi.fn(),
  complete: vi.fn(),
  evidence: vi.fn(),
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: class extends Error {},
}))
vi.mock('@/lib/uploads/upload-session/application', () => ({
  createWorkspaceFileUploadOperation: { execute: mocks.create },
  completeWorkspaceFileUploadOperation: { execute: mocks.complete },
}))

import { createFileUploadTransport } from '@/lib/mothership/agent-cli/file-upload-transport'

const workspaceId = '7727ef3f-8cf6-4686-b063-2bb006a10785'
const principal = { kind: 'personal_api_key', userId: 'reader', keyId: 'key' } as const
const endpoint = 'https://sim.test'
const path = '/api/v2/files/uploads'
const source = {
  status: 'exact',
  entries: [{ encryptedValue: 'private-ciphertext', sourceUserId: 'reader' }],
} as const
const session = {
  id: 'upload',
  status: 'uploading',
  fileName: 'data.bin',
  contentType: 'application/octet-stream',
  fileSize: 4,
  expiresAt: new Date('2099-01-01'),
  error: null,
  uploadToken: 'fixture',
  transfer: { method: 'put', url: 'https://storage.test/bytes', headers: {} },
}
const fallback = vi.fn(async () => new Response('fallback'))
const makeTransport = () =>
  createFileUploadTransport({
    endpoint,
    workspaceId,
    userId: 'reader',
    fallback,
    uploadProvenance: mocks.evidence,
  })
function create(transport: typeof fetch, changes = {}) {
  return transport(`${endpoint}${path}`, {
    method: 'POST',
    headers: { 'x-api-key': 'fixture', 'content-type': 'application/json' },
    body: JSON.stringify({
      workspaceId,
      name: 'data.bin',
      contentType: 'application/octet-stream',
      size: 4,
      ...changes,
    }),
  })
}
function complete(transport: typeof fetch, uploadId = 'upload', signal?: AbortSignal) {
  return transport(`${endpoint}${path}/${uploadId}/complete?workspaceId=${workspaceId}`, {
    method: 'POST',
    headers: { 'x-api-key': 'fixture', 'upload-token': 'fixture' },
    signal,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  fallback.mockResolvedValue(new Response('fallback'))
  mocks.authenticate.mockResolvedValue({ principal })
  mocks.create.mockResolvedValue(session)
  mocks.complete.mockResolvedValue({ session: { ...session, status: 'completed' }, value: null })
  mocks.evidence.mockReturnValue(source)
})

describe('private embedded upload control', () => {
  it('uses pending creation and completed stream evidence without exposing either in the CLI response', async () => {
    const transport = makeTransport()
    const created = await create(transport)
    expect(created.status).toBe(200)
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ principal, secretProvenance: 'pending' })
    )
    expect(mocks.evidence).not.toHaveBeenCalled()
    const completed = await complete(transport)
    expect(completed.status).toBe(200)
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ principal, secretProvenance: source })
    )
    for (const response of [created, completed]) {
      const body = await response.text()
      expect(body).not.toContain('secretProvenance')
      expect(body).not.toContain('private-ciphertext')
    }
    expect(fallback).not.toHaveBeenCalled()
  })

  it('cannot seal a session created by a different invocation', async () => {
    await create(makeTransport())
    expect((await complete(makeTransport())).status).toBe(500)
    expect(mocks.evidence).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it('refuses completion before the snapshot finishes streaming', async () => {
    const transport = makeTransport()
    await create(transport)
    mocks.evidence.mockImplementation(() => {
      throw new Error('not finished')
    })
    expect((await complete(transport)).status).toBe(500)
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it('checks the current identity again on completion', async () => {
    const transport = makeTransport()
    await create(transport)
    mocks.authenticate.mockResolvedValue({ principal: { ...principal, userId: 'other' } })
    expect((await complete(transport)).status).toBe(401)
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it('keeps workspace ownership outside request-controlled input', async () => {
    expect(
      (await create(makeTransport(), { workspaceId: '1127ef3f-8cf6-4686-b063-2bb006a10785' }))
        .status
    ).toBe(401)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects caller classification under the unchanged strict public contract', async () => {
    const response = await create(makeTransport(), { secretProvenance: source })
    expect(response.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('Stop prevents completion and source lookup', async () => {
    const transport = makeTransport()
    await create(transport)
    const controller = new AbortController()
    controller.abort(new Error('stopped'))
    await expect(complete(transport, 'upload', controller.signal)).rejects.toThrow('stopped')
    expect(mocks.evidence).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it('preserves unrelated methods, paths and origins', async () => {
    const transport = makeTransport()
    for (const url of [
      `https://other.test${path}`,
      `${endpoint}${path}/upload/parts`,
      `${endpoint}/api/v2/tables`,
    ]) {
      await transport(url, { method: 'POST' })
    }
    await transport(`${endpoint}${path}/upload`, { method: 'GET' })
    expect(fallback).toHaveBeenCalledTimes(4)
    expect(mocks.authenticate).not.toHaveBeenCalled()
  })
})
