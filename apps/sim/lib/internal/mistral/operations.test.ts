/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  submit,
  authorizeFile,
  downloadFile,
  downloadUrl,
  modelSafeFile,
  countPages,
  resolveUrl,
  validateUrl,
} = vi.hoisted(() => ({
  submit: vi.fn(),
  authorizeFile: vi.fn(),
  downloadFile: vi.fn(),
  modelSafeFile: vi.fn(),
  downloadUrl: vi.fn(),
  countPages: vi.fn(),
  resolveUrl: vi.fn(),
  validateUrl: vi.fn(),
}))

vi.mock('@/lib/internal/mistral/client', () => ({ submitMistralOcr: submit }))
vi.mock('@/lib/internal/mistral/page-count', () => ({ countMistralPdfPages: countPages }))
vi.mock('@/lib/core/security/input-validation.server', () => ({ validateUrlWithDNS: validateUrl }))
vi.mock('@/app/api/files/authorization', () => ({ assertToolFileAccess: authorizeFile }))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: downloadFile,
  downloadFileFromUrl: downloadUrl,
  resolveInternalFileUrl: resolveUrl,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: modelSafeFile,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE: 'Unsafe model input',
}))

import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import type { MistralParseInput } from '@/lib/internal/mistral/input'
import {
  executeMistralParse,
  type MistralOperationContext,
} from '@/lib/internal/mistral/operations'

describe('Mistral ingestion authorization', () => {
  const bytes = Buffer.from('Synthetic OCR fixture')
  const file = {
    key: 'ocr/fixture',
    name: 'fixture.png',
    type: 'image/png',
    size: bytes.length,
    base64: bytes.toString('base64'),
  }
  let input: MistralParseInput
  let context: MistralOperationContext

  beforeEach(() => {
    vi.clearAllMocks()
    submit.mockResolvedValue({ pages: [{ markdown: 'Synthetic OCR fixture' }] })
    authorizeFile.mockResolvedValue(new Response(null, { status: 404 }))
    modelSafeFile.mockResolvedValue(true)
    countPages.mockResolvedValue(1)
    validateUrl.mockResolvedValue({ isValid: true, resolvedIP: '1.1.1.1' })
    input = {
      apiKey: 'fixture-key',
      file: { ...file },
      [RESOLVED_SECRET_PROVENANCE_FIELD]: { version: 1, complete: true, entries: [] },
    }
    context = {
      headers: new Headers({
        [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
      }),
      requestId: 'fixture-request',
      trustedCaller: 'knowledge-ingestion',
      deadlineAt: Date.now() + 120_000,
    }
  })
  afterEach(() => vi.useRealTimers())

  it('accepts already-authorized inline bytes from the ingestion worker without a user session', async () => {
    await expect(executeMistralParse(input, context)).resolves.toMatchObject({ success: true })
    expect(submit).toHaveBeenCalledWith(
      'fixture-key',
      {
        model: 'mistral-ocr-latest',
        document: { type: 'image_url', image_url: `data:image/png;base64,${file.base64}` },
      },
      expect.any(AbortSignal),
      undefined,
      context.deadlineAt,
      { expectedPages: undefined, maxAdmissionWaitMs: 5000 }
    )
    expect(authorizeFile).not.toHaveBeenCalled()
    expect(downloadFile).not.toHaveBeenCalled()
  })

  it('refuses the same inline bytes from an unauthenticated tool caller', async () => {
    await expect(
      executeMistralParse(input, { ...context, trustedCaller: undefined })
    ).rejects.toMatchObject({ status: 401 })
    expect(submit).not.toHaveBeenCalled()
  })

  it('does not let trusted ingestion bypass storage authorization for an unmaterialized file', async () => {
    input.file = { key: file.key, name: file.name, type: file.type, size: file.size }
    await expect(executeMistralParse(input, context)).rejects.toMatchObject({ status: 404 })
    expect(authorizeFile).toHaveBeenCalledWith(file.key, '', 'fixture-request', expect.any(Object))
    expect(downloadFile).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('rejects incomplete provenance before sending trusted inline bytes to the model', async () => {
    input[RESOLVED_SECRET_PROVENANCE_FIELD] = { version: 1, complete: false, entries: [] }
    await expect(executeMistralParse(input, context)).rejects.toMatchObject({
      status: 400,
      body: { success: false, error: 'Model input provenance is unavailable' },
    })
    expect(submit).not.toHaveBeenCalled()
  })

  it('measures inline tool PDFs instead of reserving 1000 pages for a one-page document', async () => {
    const pdfBytes = Buffer.from('%PDF-1.7 synthetic one-page fixture')
    input.file = {
      ...file,
      name: 'fixture.pdf',
      type: 'application/pdf',
      base64: pdfBytes.toString('base64'),
    }
    await executeMistralParse(input, {
      ...context,
      trustedCaller: undefined,
      userId: 'user-1',
      expectedPages: 500,
    })
    expect(countPages).toHaveBeenCalledWith(pdfBytes, expect.any(AbortSignal))
    expect(submit.mock.calls[0][5]).toEqual({ expectedPages: 1, maxAdmissionWaitMs: undefined })
  })

  it('reuses authorized storage bytes for page measurement and propagates cancellation', async () => {
    const pdfBytes = Buffer.from('%PDF-1.7 stored fixture')
    input.file = {
      key: file.key,
      name: 'fixture.pdf',
      type: 'application/pdf',
      size: pdfBytes.length,
    }
    authorizeFile.mockResolvedValue(null)
    downloadFile.mockResolvedValue({ buffer: pdfBytes, contentType: 'application/pdf' })
    await executeMistralParse(input, { ...context, trustedCaller: undefined, userId: 'user-1' })
    expect(downloadFile).toHaveBeenCalledWith(
      expect.any(Object),
      context.requestId,
      expect.any(Object),
      {
        maxBytes: 50_000_000,
        signal: expect.any(AbortSignal),
      }
    )
    expect(countPages.mock.calls[0][0]).toBe(pdfBytes)
    expect(submit.mock.calls[0][5].expectedPages).toBe(1)
  })

  it.each([{ expectedPages: 30 }, { pages: [0, 1] }])(
    'avoids recounting trusted or explicitly selected pages: %j',
    async (options) => {
      input.file = { ...file, name: 'fixture.pdf', type: 'application/pdf' }
      if ('pages' in options) input.pages = options.pages
      await executeMistralParse(input, {
        ...context,
        ...('expectedPages' in options ? options : {}),
      })
      expect(countPages).not.toHaveBeenCalled()
    }
  )

  it('downloads an unselected remote PDF once and sends the measured bytes inline', async () => {
    const pdfBytes = Buffer.from('%PDF-1.7 remote fixture')
    input.file = 'https://fixture.example/download?id=document'
    downloadUrl.mockResolvedValue(pdfBytes)
    await executeMistralParse(input, { ...context, trustedCaller: undefined, userId: 'user-1' })
    expect(downloadUrl).toHaveBeenCalledOnce()
    expect(downloadUrl).toHaveBeenCalledWith(
      input.file,
      expect.objectContaining({ maxBytes: 50_000_000, signal: expect.any(AbortSignal) })
    )
    expect(submit.mock.calls[0][1].document).toEqual({
      type: 'document_url',
      document_url: `data:application/pdf;base64,${pdfBytes.toString('base64')}`,
    })
    expect(submit.mock.calls[0][5].expectedPages).toBe(1)
  })

  it('does not download selected remote pages or inferred images to count them', async () => {
    input.file = 'https://fixture.example/document.pdf'
    input.pages = [0]
    await executeMistralParse(input, context)
    input.file = 'https://fixture.example/image.png'
    input.pages = undefined
    await executeMistralParse(input, context)
    expect(downloadUrl).not.toHaveBeenCalled()
    expect(countPages).not.toHaveBeenCalled()
  })

  it('checks model-input provenance before fetching an external PDF', async () => {
    input.file = 'https://fixture.example/document.pdf'
    input[RESOLVED_SECRET_PROVENANCE_FIELD] = { version: 1, complete: false, entries: [] }
    await expect(executeMistralParse(input, context)).rejects.toMatchObject({ status: 400 })
    expect(downloadUrl).not.toHaveBeenCalled()
  })

  it('bounds stalled input preparation and never dispatches after its deadline', async () => {
    vi.useFakeTimers()
    input.file = 'https://fixture.example/document.pdf'
    let completeDownload!: (value: Buffer) => void
    downloadUrl.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeDownload = resolve
        })
    )
    const result = executeMistralParse(input, { ...context, deadlineAt: Date.now() + 10 })
    const check = expect(result).rejects.toMatchObject({ reason: 'provider_timeout' })
    await vi.advanceTimersByTimeAsync(10)
    await check
    expect(downloadUrl.mock.calls[0][1].signal.aborted).toBe(true)
    completeDownload(Buffer.from('%PDF-1.7 late download'))
    await vi.advanceTimersByTimeAsync(1)
    expect(countPages).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })
})
