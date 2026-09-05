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
  executeOraclePcmFileOperation,
  PCM_MAX_TRANSFER_BYTES,
} from '@/lib/internal/oracle-epm-profitability/files.server'

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
const listing = (name = 'profitoutbox/report final.csv', size = '3', type = 'EXTERNAL') =>
  json({
    status: 0,
    items: [{ name, size, type, lastmodifiedtime: '1422534438000' }],
  })

describe('Oracle PCM ordinary repository files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dns.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mocks.fetch.mockImplementation(() => json({ status: 0 }))
    mocks.open.mockResolvedValue({
      fileName: 'report.csv',
      contentType: 'text/csv',
      maxBytes: PCM_MAX_TRANSFER_BYTES,
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
      fileName: 'report final.csv',
      file: [file],
      userId: 'untrusted-user',
    }
    expect(
      await executeOraclePcmFileOperation('upload_file', input, signal, context)
    ).toMatchObject({
      success: true,
      retryable: false,
      output: { fileName: `profitinbox/${input.fileName}`, status: 0 },
    })
    expect(mocks.open).toHaveBeenCalledWith({
      file,
      userId: context.userId,
      maxBytes: PCM_MAX_TRANSFER_BYTES,
      signal,
    })
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      'https://epm.example.com/gateway/interop/rest/11.1.2.3.600/applicationsnapshots/report%20final.csv/contents?extDirPath=profitinbox'
    )
    expect(mocks.fetch.mock.calls[0][2]).toMatchObject({ method: 'POST', body: Buffer.from('abc') })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('rejects actorless and multiple-file uploads before provider calls', async () => {
    await expect(
      executeOraclePcmFileOperation('upload_file', {
        ...auth,
        fileName: 'data.csv',
        file,
        userId: 'forged',
      })
    ).rejects.toThrow('actor')
    await expect(
      executeOraclePcmFileOperation(
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
      executeOraclePcmFileOperation(
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
      maxBytes: PCM_MAX_TRANSFER_BYTES,
      chunks: (async function* () {
        for (let index = 0; index < 101; index++) yield chunk
      })(),
    })
    await expect(
      executeOraclePcmFileOperation(
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
        executeOraclePcmFileOperation(
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
    const result = await executeOraclePcmFileOperation(
      'download_file',
      { ...auth, fileName: 'profitoutbox/report final.csv', workspaceId: 'forged' },
      signal,
      context
    )
    expect(result.output).toEqual({ file })
    expect(mocks.store).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'report final.csv',
        maxBytes: PCM_MAX_TRANSFER_BYTES,
        contentLength: 3,
        signal,
        context: {
          workspaceId: context.workspaceId,
          workflowId: context.workflowId,
          executionId: context.executionId,
        },
      })
    )
    expect(mocks.fetch.mock.calls[1][0]).toContain('/profitoutbox%2Freport%20final.csv/contents')
  })
  it('does not save Oracle JSON download errors as successful files', async () => {
    mocks.fetch
      .mockImplementationOnce(() => listing())
      .mockImplementationOnce(() => json({ status: 1, details: 'Invalid file' }))
    await expect(
      executeOraclePcmFileOperation(
        'download_file',
        { ...auth, fileName: 'profitoutbox/report final.csv' },
        undefined,
        context
      )
    ).rejects.toThrow('no file was stored')
    expect(mocks.store).not.toHaveBeenCalled()
  })
  it('rejects oversized downloads from repository metadata', async () => {
    mocks.fetch.mockImplementationOnce(() =>
      listing('profitoutbox/data.csv', String(PCM_MAX_TRANSFER_BYTES + 1))
    )
    await expect(
      executeOraclePcmFileOperation(
        'download_file',
        { ...auth, fileName: 'profitoutbox/data.csv' },
        undefined,
        context
      )
    ).rejects.toThrow('100 MiB')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('does not let manual names target snapshots or unrelated repository files', async () => {
    mocks.fetch.mockImplementation(() =>
      json({
        status: 0,
        items: [
          { name: 'profitoutbox/snapshot', type: 'LCM', size: null, lastmodifiedtime: null },
          { name: 'inbox/data.csv', type: 'EXTERNAL', size: '3', lastmodifiedtime: '0' },
        ],
      })
    )
    for (const fileName of ['profitoutbox/snapshot', 'inbox/data.csv']) {
      await expect(
        executeOraclePcmFileOperation('download_file', { ...auth, fileName }, undefined, context)
      ).rejects.toThrow('not found')
    }
    expect(mocks.store).not.toHaveBeenCalled()
    expect(mocks.fetch.mock.calls.every((call) => call[2].method === 'GET')).toBe(true)
  })

  it('lists only PCM ordinary files, preserving long and whitespace-sensitive names', async () => {
    const longName = `profitinbox/${'x'.repeat(300)}`
    mocks.fetch.mockImplementation(() =>
      json({
        status: 0,
        items: [
          { name: longName, type: 'EXTERNAL', size: '3', lastmodifiedtime: '0' },
          { name: 'profitoutbox/report.csv ', type: 'EXTERNAL', size: '3', lastmodifiedtime: '0' },
          { name: 'inbox/other.csv', type: 'EXTERNAL', size: '3', lastmodifiedtime: '0' },
          { name: 'Snapshot', type: 'LCM', size: null, lastmodifiedtime: null },
        ],
      })
    )
    expect(await executeOraclePcmFileOperation('list_files', auth)).toMatchObject({
      output: {
        files: [
          { name: longName, size: 3, lastModifiedTime: 0 },
          { name: 'profitoutbox/report.csv ', size: 3, lastModifiedTime: 0 },
        ],
      },
    })
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      'https://epm.example.com/gateway/interop/rest/v2/files/list'
    )
  })

  it('rejects UTF-8 paths beyond the download boundary before source access or HTTP', async () => {
    const name = `${'é'.repeat(123)}.csv`
    await expect(
      executeOraclePcmFileOperation(
        'upload_file',
        { ...auth, fileName: name, file },
        undefined,
        context
      )
    ).rejects.toThrow('255 UTF-8 bytes')
    await expect(
      executeOraclePcmFileOperation(
        'download_file',
        { ...auth, fileName: `profitoutbox/${name}` },
        undefined,
        context
      )
    ).rejects.toThrow('255 UTF-8 bytes')
    expect(mocks.open).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('propagates cancellation without opening files or calling Oracle', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      executeOraclePcmFileOperation(
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
