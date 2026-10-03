/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), dns: vi.fn(), open: vi.fn(), store: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.dns,
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: mocks.open,
  storeOracleEpmDownload: mocks.store,
}))

import {
  EPCM_MAX_TRANSFER_BYTES,
  executeOracleEpcmFileOperation,
} from '@/lib/internal/oracle-epm-enterprise-profitability/files.server'

const auth = {
  oauthCredential: 'credential-1',
  accessToken: Buffer.from('test-user:test-password').toString('base64'),
  instanceUrl: 'https://epm.example.com/gateway',
}
const context = {
  userId: 'user-1',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  workflowId: '00000000-0000-4000-8000-000000000002',
  executionId: '00000000-0000-4000-8000-000000000003',
}
const file = {
  id: 'file-1',
  key: 'execution/report.csv',
  name: 'report.csv',
  size: 3,
  type: 'text/csv',
  url: 'https://storage.example/report.csv',
}
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const listing = (name = 'inbox/report final.csv', size = '3', type = 'EXTERNAL') =>
  json({
    status: 0,
    items: [{ name, size, type, lastmodifiedtime: '1422534438000' }],
  })

describe('Oracle EPCM ordinary repository files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dns.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mocks.fetch.mockImplementation(() => json({ status: 0 }))
    mocks.open.mockResolvedValue({
      fileName: 'report.csv',
      contentType: 'text/csv',
      maxBytes: EPCM_MAX_TRANSFER_BYTES,
      chunks: (async function* () {
        yield Buffer.from('abc')
      })(),
    })
    mocks.store.mockImplementation(async ({ body }: { body: ReadableStream<Uint8Array> }) => {
      await new Response(body).arrayBuffer()
      return file
    })
  })

  it('uploads one canonical file using trusted actor authority and a bounded binary POST', async () => {
    const signal = new AbortController().signal
    const input = {
      ...auth,
      fileName: 'inbox/report final.csv',
      file: [file],
      userId: 'untrusted-user',
    }
    expect(
      await executeOracleEpcmFileOperation('upload_file', input, signal, context)
    ).toMatchObject({
      success: true,
      retryable: false,
      output: { fileName: input.fileName, status: 0 },
    })
    expect(mocks.open).toHaveBeenCalledWith({
      file,
      userId: context.userId,
      maxBytes: EPCM_MAX_TRANSFER_BYTES,
      signal,
    })
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      'https://epm.example.com/gateway/interop/rest/11.1.2.3.600/applicationsnapshots/inbox%2Freport%20final.csv/contents'
    )
    expect(mocks.fetch.mock.calls[0][2]).toMatchObject({ method: 'POST', body: Buffer.from('abc') })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('rejects actorless and multiple-file uploads before provider calls', async () => {
    await expect(
      executeOracleEpcmFileOperation('upload_file', {
        ...auth,
        fileName: 'data.csv',
        file,
        userId: 'forged',
      })
    ).rejects.toThrow('actor')
    await expect(
      executeOracleEpcmFileOperation(
        'upload_file',
        { ...auth, fileName: 'data.csv', file: [file, file] },
        undefined,
        context
      )
    ).rejects.toThrow('exactly one')
    expect(mocks.open).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('honors denied source access before uploading', async () => {
    mocks.open.mockRejectedValue(new Error('File access denied'))
    await expect(
      executeOracleEpcmFileOperation(
        'upload_file',
        { ...auth, fileName: 'data.csv', file },
        undefined,
        context
      )
    ).rejects.toThrow('denied')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('checks actual upload bytes even when source metadata is smaller', async () => {
    const chunk = Buffer.alloc(1024 * 1024)
    mocks.open.mockResolvedValue({
      fileName: 'report.csv',
      contentType: 'text/csv',
      maxBytes: EPCM_MAX_TRANSFER_BYTES,
      chunks: (async function* () {
        for (let index = 0; index < 101; index++) yield chunk
      })(),
    })
    await expect(
      executeOracleEpcmFileOperation(
        'upload_file',
        { ...auth, fileName: 'data.csv', file },
        undefined,
        context
      )
    ).rejects.toThrow('maximum size')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it.each([1, -1])(
    'does not overwrite, delete, retry, or follow snapshot processing on status %s',
    async (status) => {
      mocks.fetch.mockImplementation(() => json({ status, details: 'provider detail' }))
      await expect(
        executeOracleEpcmFileOperation(
          'upload_file',
          { ...auth, fileName: 'data.zip', file },
          undefined,
          context
        )
      ).rejects.toThrow()
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect(mocks.fetch.mock.calls[0][2].method).toBe('POST')
    }
  )
  it('stores a downloaded stream as a canonical UserFile with trusted scope and caps', async () => {
    mocks.fetch
      .mockImplementationOnce(() => listing())
      .mockImplementationOnce(
        () =>
          new Response('abc', { headers: { 'content-type': 'text/csv', 'content-length': '3' } })
      )
    const signal = new AbortController().signal
    const result = await executeOracleEpcmFileOperation(
      'download_file',
      { ...auth, fileName: 'inbox/report final.csv', workspaceId: 'forged' },
      signal,
      context
    )
    expect(result.output).toEqual({ file })
    expect(mocks.store).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'report final.csv',
        maxBytes: EPCM_MAX_TRANSFER_BYTES,
        contentLength: 3,
        signal,
        context: {
          workspaceId: context.workspaceId,
          workflowId: context.workflowId,
          executionId: context.executionId,
        },
      })
    )
    expect(mocks.fetch.mock.calls[1][0]).toContain('/inbox%2Freport%20final.csv/contents')
  })
  it('does not save Oracle JSON download errors as successful files', async () => {
    mocks.fetch
      .mockImplementationOnce(() => listing())
      .mockImplementationOnce(() => json({ status: 1, details: 'Invalid file' }))
    await expect(
      executeOracleEpcmFileOperation(
        'download_file',
        { ...auth, fileName: 'inbox/report final.csv' },
        undefined,
        context
      )
    ).rejects.toThrow('no file was stored')
    expect(mocks.store).not.toHaveBeenCalled()
  })
  it('rejects oversized downloads from repository metadata', async () => {
    mocks.fetch.mockImplementationOnce(() =>
      listing('data.csv', String(EPCM_MAX_TRANSFER_BYTES + 1))
    )
    await expect(
      executeOracleEpcmFileOperation(
        'download_file',
        { ...auth, fileName: 'data.csv' },
        undefined,
        context
      )
    ).rejects.toThrow('100 MB')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it.each(['download_file', 'delete_file'])(
    'does not let manual names target snapshots in %s',
    async (operation) => {
      mocks.fetch.mockImplementation(() =>
        json({
          status: 0,
          items: [{ name: 'Artifact Snapshot', type: 'LCM', size: null, lastmodifiedtime: null }],
        })
      )
      await expect(
        executeOracleEpcmFileOperation(
          operation,
          { ...auth, fileName: 'Artifact Snapshot' },
          undefined,
          context
        )
      ).rejects.toThrow('snapshots')
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    }
  )
  it('deletes only the verified ordinary file using the v2 payload spelling', async () => {
    mocks.fetch
      .mockImplementationOnce(() => listing('data.csv'))
      .mockImplementationOnce(() => json({ status: 0 }))
    expect(
      await executeOracleEpcmFileOperation('delete_file', { ...auth, fileName: 'data.csv' })
    ).toMatchObject({ success: true, output: { fileName: 'data.csv', status: 0 } })
    expect(mocks.fetch.mock.calls[1][0]).toBe(
      'https://epm.example.com/gateway/interop/rest/v2/files/delete'
    )
    expect(mocks.fetch.mock.calls[1][2]).toMatchObject({
      method: 'DELETE',
      body: '{"fileName":"data.csv"}',
    })
  })
  it('propagates cancellation without opening files or calling Oracle', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      executeOracleEpcmFileOperation(
        'upload_file',
        { ...auth, fileName: 'data.csv', file },
        controller.signal,
        context
      )
    ).rejects.toThrow()
    expect(mocks.open).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
