/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), dns: vi.fn(), source: vi.fn(), store: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.dns,
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: mocks.source,
  storeOracleEpmDownload: mocks.store,
}))

import { createTimeoutAbortController } from '@/lib/core/execution-limits'
import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import {
  downloadArcsAttachment,
  exportArcsUserReport,
  getArcsFileContext,
  storeArcsFile,
  uploadArcsFile,
} from '@/lib/internal/oracle-epm-account-reconciliation/files'
import { ARCS_MAX_FILE_BYTES } from '@/lib/internal/oracle-epm-account-reconciliation/routes'

const origin = 'https://epm.example.com/gateway'
const client = createOracleEpmClient({ instanceUrl: origin, accessToken: 'dTpw' })
const context = {
  userId: 'user-1',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  workflowId: '00000000-0000-4000-8000-000000000002',
  executionId: '00000000-0000-4000-8000-000000000003',
}
const file = {
  id: 'f',
  name: 'input.csv',
  size: 3,
  type: 'text/csv',
  key: 'workspace/input.csv',
  url: '/api/files/input.csv',
}
function json(data: unknown) {
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
}
function comments(href = `${origin}/arm/rest/fcmapi/v1/rc/references/7/file`, type = 'FILE') {
  return [
    {
      commentId: 1,
      parentObjectId: 2,
      commentText: 'Evidence',
      postedBy: 'reviewer',
      postedDate: 'Jan 2026',
      references: [{ referenceId: 7, type, name: 'input.csv', url: null, fileDownloadLink: href }],
    },
  ]
}

describe('Account Reconciliation file orchestration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.dns.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
    mocks.store.mockResolvedValue(file)
    mocks.source.mockResolvedValue({
      fileName: 'input.csv',
      contentType: 'text/csv',
      maxBytes: 3,
      chunks: (async function* () {
        yield Buffer.from('abc')
      })(),
    })
  })
  it('passes the acting user, signal, and 100 MB ceiling to the authorized upload helper', async () => {
    const signal = new AbortController().signal
    mocks.fetch.mockResolvedValueOnce(json({ status: 0, details: null }))
    const result = await uploadArcsFile(client, { file, extDirPath: 'inbox/data' }, context, signal)
    expect(mocks.source).toHaveBeenCalledWith({
      file,
      userId: context.userId,
      maxBytes: ARCS_MAX_FILE_BYTES,
      signal,
    })
    expect(result).toMatchObject({ success: true, output: { fileName: 'inbox/data/input.csv' } })
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      origin +
        '/interop/rest/11.1.2.3.600/applicationsnapshots/input.csv/contents?extDirPath=inbox%2Fdata'
    )
  })
  it('stops before provider mutation when source access is denied', async () => {
    mocks.source.mockRejectedValueOnce(new Error('Not found'))
    await expect(uploadArcsFile(client, { file }, context)).rejects.toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('bounds materialization even when actual chunks exceed source metadata', async () => {
    mocks.source.mockResolvedValueOnce({
      fileName: 'input.csv',
      contentType: 'text/csv',
      maxBytes: 3,
      chunks: (async function* () {
        yield Buffer.from('abcd')
      })(),
    })
    await expect(uploadArcsFile(client, { file }, context)).rejects.toThrow('maximum size')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('does not delete or retry when Oracle refuses an existing file', async () => {
    mocks.fetch.mockResolvedValueOnce(json({ status: 1, details: 'File already exists' }))
    expect(await uploadArcsFile(client, { file }, context)).toMatchObject({
      success: false,
      output: { status: 1 },
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls[0][2].method).toBe('POST')
  })
  it('retains pending snapshot extraction rather than claiming it completed', async () => {
    mocks.fetch.mockResolvedValueOnce(json({ status: -1, details: 'Extraction in progress' }))
    expect(await uploadArcsFile(client, { file }, context)).toMatchObject({
      success: true,
      output: { status: -1, state: 'pending' },
    })
  })
  it('uses trusted execution scope and forwards declared download metadata', async () => {
    const body = new ReadableStream<Uint8Array>()
    const signal = new AbortController().signal
    expect(
      await storeArcsFile(
        { status: 200, body, contentType: 'text/csv', contentLength: 3 },
        'input.csv',
        getArcsFileContext(context),
        signal
      )
    ).toEqual(file)
    expect(mocks.store).toHaveBeenCalledWith({
      body,
      fileName: 'input.csv',
      context: {
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        executionId: context.executionId,
      },
      contentType: 'text/csv',
      contentLength: 3,
      maxBytes: ARCS_MAX_FILE_BYTES,
      signal,
    })
  })
  it('cancels JSON error bodies and does not store them as files', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    await expect(
      storeArcsFile(
        { status: 200, body, contentType: 'application/JSON; charset=utf-8' },
        'file.csv',
        context
      )
    ).rejects.toThrow('JSON error')
    expect(cancel).toHaveBeenCalled()
    expect(mocks.store).not.toHaveBeenCalled()
  })
  it('cancels a body when the storage helper rejects before consuming it', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    mocks.store.mockRejectedValueOnce(new Error('Size limit'))
    await expect(
      storeArcsFile(
        { status: 200, body, contentLength: ARCS_MAX_FILE_BYTES + 1 },
        'file.csv',
        context
      )
    ).rejects.toThrow('Size limit')
    expect(cancel).toHaveBeenCalled()
  })
  it('downloads only a FILE reference belonging to the requested reconciliation', async () => {
    mocks.fetch.mockResolvedValueOnce(json(comments())).mockResolvedValueOnce(new Response('abc'))
    expect(
      await downloadArcsAttachment(
        client,
        { period: 'Jan', accountId: 'Account', referenceId: '7' },
        context
      )
    ).toMatchObject({ success: true, output: { file } })
    expect(mocks.fetch.mock.calls.map((call) => call[0])).toEqual([
      `${origin}/armARCS/rest/v1/period/Jan/reconciliation/Account/comments`,
      `${origin}/arm/rest/fcmapi/v1/rc/references/7/file`,
    ])
  })
  it.each([
    { referenceId: '8', href: `${origin}/arm/rest/fcmapi/v1/rc/references/7/file`, type: 'FILE' },
    { referenceId: '7', href: `${origin}/arm/rest/fcmapi/v1/rc/references/8/file`, type: 'FILE' },
    {
      referenceId: '7',
      href: 'https://other.example.com/arm/rest/fcmapi/v1/rc/references/7/file',
      type: 'FILE',
    },
    { referenceId: '7', href: `${origin}/arm/rest/fcmapi/v1/rc/references/7/file`, type: 'URL' },
  ])('rejects unrelated or invalid attachment references %j', async (input) => {
    mocks.fetch.mockResolvedValueOnce(json(comments(input.href, input.type)))
    await expect(
      downloadArcsAttachment(
        client,
        { period: 'Jan', accountId: 'Account', referenceId: input.referenceId },
        context
      )
    ).rejects.toThrow()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.store).not.toHaveBeenCalled()
  })
  it('rejects missing execution scope before generating a report', async () => {
    await expect(
      exportArcsUserReport(client, { fileName: 'report.csv' }, { workflowId: context.workflowId })
    ).rejects.toThrow('execution context')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('preserves the execution cleanup reserve after accepting a report', async () => {
    const controller = createTimeoutAbortController(900)
    mocks.fetch
      .mockResolvedValueOnce(
        json({
          status: -1,
          links: [
            { rel: 'Job Status', action: 'GET', href: `${origin}/arm/rest/fcmapi/v1/rc/job/42` },
          ],
        })
      )
      .mockResolvedValueOnce(json({ status: 0, links: [] }))
    try {
      expect(
        await exportArcsUserReport(client, { fileName: 'report.csv' }, context, controller.signal)
      ).toMatchObject({ success: false, output: { accepted: true, jobId: '42', status: -1 } })
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    } finally {
      controller.cleanup()
    }
  })
  it('preserves the completed report job when its download fails', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        json({
          status: -1,
          links: [
            { rel: 'Job Status', action: 'GET', href: `${origin}/arm/rest/fcmapi/v1/rc/job/42` },
          ],
        })
      )
      .mockResolvedValueOnce(
        json({
          status: 0,
          links: [
            {
              rel: 'report-content',
              action: 'GET',
              href: `${origin}/interop/rest/11.1.2.3.600/applicationsnapshots/report.csv/contents`,
            },
          ],
        })
      )
      .mockResolvedValueOnce(new Response('Failed', { status: 503 }))
    expect(await exportArcsUserReport(client, { fileName: 'report.csv' }, context)).toMatchObject({
      success: false,
      output: {
        accepted: true,
        jobId: '42',
        status: 0,
        state: 'succeeded',
        fileName: 'report.csv',
      },
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(3)
    expect(mocks.store).not.toHaveBeenCalled()
  })
  it('rejects a report link for a different repository file', async () => {
    mocks.fetch.mockResolvedValueOnce(
      json({
        status: 0,
        links: [
          {
            rel: 'report-content',
            action: 'GET',
            href: `${origin}/interop/rest/11.1.2.3.600/applicationsnapshots/other.csv/contents`,
          },
        ],
      })
    )
    expect(await exportArcsUserReport(client, { fileName: 'report.csv' }, context)).toMatchObject({
      success: false,
      output: { accepted: true, status: 0 },
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})
