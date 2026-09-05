/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  uploadCopilotFile: vi.fn(),
  uploadExecutionFile: vi.fn(),
  guardedFetch: vi.fn(),
  closeDispatcher: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/copilot', () => ({
  uploadCopilotFile: mocks.uploadCopilotFile,
}))
vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mocks.uploadExecutionFile,
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  createSsrfGuardedFetchWithDispatcher: () => ({
    fetch: mocks.guardedFetch,
    dispatcher: { close: mocks.closeDispatcher },
  }),
}))
vi.mock('@/tools/quickbooks/client', () => ({
  QUICKBOOKS_MAX_RESPONSE_BYTES: 8 * 1024 * 1024,
  buildQuickBooksCompanyUrl: (realmId: string, resource: string) => {
    const url = new URL(`https://quickbooks.api.intuit.com/v3/company/${realmId}/${resource}`)
    url.searchParams.set('minorversion', '75')
    return url
  },
  buildQuickBooksHeaders: (accessToken: string) => ({
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  }),
}))

import { executeQuickBooksDownloadDocument } from '@/lib/internal/quickbooks/operations'
import { QUICKBOOKS_MAX_ATTACHMENT_BYTES } from '@/tools/quickbooks/documents_utils'

const COPILOT_FILE = {
  id: 'file-1',
  key: 'copilot/file-1',
  context: 'copilot',
  name: 'receipt.png',
  url: '/api/files/serve/copilot/file-1',
  size: 4,
  type: 'image/png',
}

function context(overrides: Record<string, string> = {}) {
  return {
    userId: 'user-1',
    requestId: 'request-1',
    signal: new AbortController().signal,
    ...overrides,
  }
}

describe('QuickBooks internal operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    mocks.closeDispatcher.mockResolvedValue(undefined)
    mocks.uploadCopilotFile.mockResolvedValue(COPILOT_FILE)
    mocks.uploadExecutionFile.mockResolvedValue({ ...COPILOT_FILE, context: 'execution' })
  })

  it('resolves Intuit temporary URLs and downloads attachment bytes without forwarding OAuth', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('"https://attachments.example/receipt.png?signature=secret"', {
        headers: { 'content-type': 'text/plain' },
      })
    )
    mocks.guardedFetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: {
          'content-disposition': 'attachment; filename="receipt.png"',
          'content-length': '4',
          'content-type': 'image/png',
        },
      })
    )

    const result = await executeQuickBooksDownloadDocument(
      {
        documentKind: 'attachment',
        accessToken: 'secret-token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        attachmentId: 'attachment-1',
      },
      context()
    )

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toMatch(
      /^https:\/\/(sandbox-)?quickbooks\.api\.intuit\.com\/v3\/company\/123\/download\/attachment-1\?minorversion=75$/
    )
    expect(init).toEqual(
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
      })
    )
    expect(mocks.guardedFetch).toHaveBeenCalledWith(
      'https://attachments.example/receipt.png?signature=secret',
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: '*/*' },
      })
    )
    expect(mocks.closeDispatcher).toHaveBeenCalledOnce()
    expect(mocks.uploadCopilotFile).toHaveBeenCalledWith({
      buffer: Buffer.from([1, 2, 3, 4]),
      fileName: 'receipt.png',
      contentType: 'image/png',
      userId: 'user-1',
    })
    expect(result).toMatchObject({ file: COPILOT_FILE, attachmentId: 'attachment-1' })
  })

  it('rejects an oversized attachment from Content-Length before buffering it', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('https://attachments.example/oversized.bin', {
        headers: { 'content-type': 'text/plain' },
      })
    )
    mocks.guardedFetch.mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: { 'content-length': String(QUICKBOOKS_MAX_ATTACHMENT_BYTES + 1) },
      })
    )

    await expect(
      executeQuickBooksDownloadDocument(
        {
          documentKind: 'attachment',
          accessToken: 'secret-token',
          realmId: '123',
          quickBooksEnvironment: 'sandbox',
          attachmentId: 'attachment-1',
        },
        context()
      )
    ).rejects.toThrow('exceeds maximum size')
    expect(mocks.closeDispatcher).toHaveBeenCalledOnce()
    expect(mocks.uploadCopilotFile).not.toHaveBeenCalled()
  })

  it('rejects malformed PDF content before storing it', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(new TextEncoder().encode('not a PDF'), {
        headers: { 'content-type': 'application/pdf' },
      })
    )

    await expect(
      executeQuickBooksDownloadDocument(
        {
          documentKind: 'transaction_pdf',
          accessToken: 'secret-token',
          realmId: '123',
          quickBooksEnvironment: 'sandbox',
          transactionType: 'invoice',
          transactionId: 'invoice-1',
        },
        context()
      )
    ).rejects.toThrow('malformed PDF')
    expect(mocks.uploadCopilotFile).not.toHaveBeenCalled()
  })

  it('stores valid PDFs in trusted execution scope', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\n')
    vi.mocked(fetch).mockResolvedValue(
      new Response(pdf, { headers: { 'content-type': 'application/pdf' } })
    )

    await executeQuickBooksDownloadDocument(
      {
        documentKind: 'transaction_pdf',
        accessToken: 'secret-token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        transactionType: 'invoice',
        transactionId: 'invoice-1',
      },
      context({
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
    )

    expect(mocks.uploadExecutionFile).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
      Buffer.from(pdf),
      'quickbooks-invoice-invoice-1.pdf',
      'application/pdf',
      'user-1'
    )
    expect(mocks.uploadCopilotFile).not.toHaveBeenCalled()
  })
})
