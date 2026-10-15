import type { Principal } from '@sim/auth/principal'
import {
  createDelegatedPrincipal,
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { fileParsersMock, fileParsersMockFns } from '@sim/testing/mocks/file-parsers.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileReferenceMock,
  workspaceFileReferenceMockFns,
} from '@sim/testing/mocks/workspace-file-reference.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ContentDeliveryUnobservedError,
  ContentRefusedError,
  type ContentSource,
  observeContentDelivery,
} from '@/lib/core/application'
import { FileParserError } from '@/lib/file-parsers/errors'

const hoisted = vi.hoisted(() => ({
  fetchServable: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock(
  '@/lib/workspace-files/application/resolve-workspace-file-reference',
  () => workspaceFileReferenceMock
)

vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)

vi.mock('@/lib/workspace-files/application/fetch-servable-workspace-file-buffer', () => ({
  fetchAuthorizedServableWorkspaceFileBuffer: hoisted.fetchServable,
}))

vi.mock('@/lib/file-parsers', () => fileParsersMock)

import {
  extractWorkspaceFileRecordText,
  readWorkspaceFileText,
} from '@/lib/workspace-files/application/read-workspace-file-text'

const mocks = {
  provenance: workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenance,
  fetchBuffer: workspaceUploadsMockFns.mockFetchWorkspaceFileBuffer,
  ...hoisted,
  parseBuffer: fileParsersMockFns.mockParseBuffer,
  resolveContext: workspaceFileReferenceMockFns.mockResolveReferencedWorkspaceFileContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_doc'

const fileContext = {
  workspaceId: WORKSPACE_ID,
  fileId: FILE_ID,
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const principals: Principal[] = [
  createSessionPrincipal(),
  createPersonalApiKeyPrincipal({ keyId: 'key-personal' }),
  createWorkspaceApiKeyPrincipal({ workspaceId: WORKSPACE_ID, keyId: 'key-workspace' }),
]

function fileRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    workspaceId: WORKSPACE_ID,
    name: 'notes.txt',
    type: 'text/plain',
    size: 12,
    key: 'workspace/ws/notes.txt',
    storageContext: 'workspace',
    ...overrides,
  }
}

/** A record as the use case hands it to extraction, with the full shape provenance binds to. */
function fileRecordForChat() {
  return fileRecord({ contentUpdatedAt: new Date('2026-01-01T00:00:00.000Z') }) as Parameters<
    typeof extractWorkspaceFileRecordText
  >[0]
}

/** The canonical context the reference resolver hands back, carrying the record it resolved. */
function referenceContext(overrides: Record<string, unknown> = {}) {
  return { ...fileContext, file: fileRecord(overrides) }
}

function input(overrides: Record<string, unknown> = {}) {
  return { workspaceId: WORKSPACE_ID, reference: FILE_ID, ...overrides }
}

describe('readWorkspaceFileText', () => {
  beforeEach(() => {
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveContext.mockResolvedValue(referenceContext())
    mocks.fetchBuffer.mockResolvedValue(Buffer.from('hello there!'))
    mocks.fetchServable.mockResolvedValue({
      buffer: Buffer.from('%PDF-1.7 rendered'),
      contentType: 'application/pdf',
    })
    mocks.parseBuffer.mockResolvedValue({ content: 'hello there!', metadata: {} })
  })

  it('classifies a Chat read by its canonical provenance before reading any bytes', async () => {
    const provenance = { status: 'exact', entries: [] }
    mocks.provenance.mockResolvedValue(provenance)
    const admit = vi.fn(async (sources: readonly ContentSource[]) => sources.map(() => true))
    const result = await observeContentDelivery({ admit }, () =>
      extractWorkspaceFileRecordText(fileRecordForChat(), {}, createDelegatedPrincipal())
    )
    expect(admit).toHaveBeenCalledWith([
      { kind: 'workspace-file', id: FILE_ID, provenance, view: 'complete' },
    ])
    expect(admit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fetchBuffer.mock.invocationCallOrder[0]
    )
    expect(result.text).toBe('hello there!')
  })

  it('refuses a Chat read its gate refuses with a 403, before reading any bytes', async () => {
    mocks.provenance.mockResolvedValue({ status: 'unknown' })
    await expect(
      observeContentDelivery({ admit: async (sources) => sources.map(() => false) }, () =>
        extractWorkspaceFileRecordText(fileRecordForChat(), {}, createDelegatedPrincipal())
      )
    ).rejects.toBeInstanceOf(ContentRefusedError)
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
  })

  it('refuses a Chat read no gate observes, before reading provenance or bytes', async () => {
    await expect(
      extractWorkspaceFileRecordText(fileRecordForChat(), {}, createDelegatedPrincipal())
    ).rejects.toBeInstanceOf(ContentDeliveryUnobservedError)
    expect(mocks.provenance).not.toHaveBeenCalled()
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
  })

  it.each(principals)(
    'reads no provenance for a $kind caller, which no gate classifies',
    async (principal) => {
      const result = await readWorkspaceFileText.execute({ principal, input: input() })
      expect(result.text).toBe('hello there!')
      expect(mocks.provenance).not.toHaveBeenCalled()
    }
  )

  it('uses the complete text representation before selecting a line window', async () => {
    const controller = new AbortController()
    mocks.parseBuffer.mockResolvedValueOnce({ content: 'header\ntail needle\n', metadata: {} })
    const result = await readWorkspaceFileText.execute({
      principal: principals[0],
      input: input({ offset: 2, limit: 1 }),
      request: { headers: new Headers(), signal: controller.signal },
    })
    expect(mocks.fetchBuffer).toHaveBeenCalledWith(expect.anything(), {
      maxBytes: 25 * 1024 * 1024,
      signal: controller.signal,
    })
    expect(mocks.parseBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'txt', {
      contentMode: 'complete',
      pdfTextMode: 'complete',
      maxTextBytes: 25 * 1024 * 1024,
      signal: controller.signal,
    })
    expect(result.text).toBe('tail needle')
    expect(result.lineRange).toMatchObject({ offset: 2, lineCount: 1, totalLines: 2 })
  })

  it('does not fetch bytes for an already cancelled request', async () => {
    const controller = new AbortController()
    controller.abort(new Error('request cancelled'))
    await expect(
      readWorkspaceFileText.execute({
        principal: principals[0],
        input: input(),
        request: { headers: new Headers(), signal: controller.signal },
      })
    ).rejects.toBe(controller.signal.reason)
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
    expect(mocks.parseBuffer).not.toHaveBeenCalled()
  })

  it.each(['return', 'throw'])(
    'preserves cancellation when the parser would %s',
    async (outcome) => {
      const controller = new AbortController()
      const reason = new Error('request cancelled during parsing')
      mocks.parseBuffer.mockImplementationOnce(async () => {
        controller.abort(reason)
        if (outcome === 'throw') throw new FileParserError('invalid_format', 'parser stopped')
        return { content: 'abandoned output', metadata: {} }
      })
      await expect(
        readWorkspaceFileText.execute({
          principal: principals[0],
          input: input(),
          request: { headers: new Headers(), signal: controller.signal },
        })
      ).rejects.toBe(reason)
    }
  )
  it('denies a principal below the read role', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    await expect(
      readWorkspaceFileText.execute({ principal: principals[0], input: input() })
    ).rejects.toThrow()
    expect(mocks.parseBuffer).not.toHaveBeenCalled()
  })

  /**
   * The whole hazard this endpoint exists to avoid: the legacy parsers return
   * placeholder or scraped content instead of throwing, so `degraded` must
   * reach the caller rather than being swallowed or turned into an error.
   */
  it('surfaces a degraded legacy extraction with its reason', async () => {
    mocks.resolveContext.mockResolvedValueOnce(referenceContext({ name: 'legacy.doc' }))
    mocks.parseBuffer.mockResolvedValueOnce({
      content: 'Unable to extract text from DOC file. Please convert to DOCX format.',
      metadata: {
        degraded: true,
        extractionMethod: 'fallback',
        warning: 'Basic text extraction used. For better results, convert to DOCX format.',
      },
    })

    const result = await readWorkspaceFileText.execute({ principal: principals[2], input: input() })

    expect(result.degraded).toBe(true)
    expect(result.degradedReason).toBe(
      'Basic text extraction used. For better results, convert to DOCX format.'
    )
  })

  /**
   * The message is served to raw HTTP, Copilot, and the CLI alike, so it names
   * the remedy rather than an endpoint only one of those three can call.
   */
  it('keeps public extension behavior while allowing MIME-identified source text internally', async () => {
    mocks.resolveContext.mockResolvedValue(
      referenceContext({ name: 'main.ts', type: 'text/typescript' })
    )
    await expect(
      readWorkspaceFileText.execute({ principal: principals[0], input: input() })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
    await readWorkspaceFileText.execute({
      principal: principals[0],
      input: input({ allowPlainText: true }),
    })
    expect(mocks.parseBuffer).toHaveBeenCalledWith(
      Buffer.from('hello there!'),
      'txt',
      expect.objectContaining({ contentMode: 'complete', pdfTextMode: 'complete' })
    )
  })

  it('does not decode binary MIME as text when internal plain-text support is enabled', async () => {
    mocks.resolveContext.mockResolvedValue(
      referenceContext({ name: 'photo.png', type: 'image/png' })
    )
    await expect(
      readWorkspaceFileText.execute({
        principal: principals[0],
        input: input({ allowPlainText: true }),
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
  })

  it('rejects a source above the extraction ceiling before reading bytes', async () => {
    mocks.resolveContext.mockResolvedValueOnce(referenceContext({ size: 26 * 1024 * 1024 }))

    await expect(
      readWorkspaceFileText.execute({ principal: principals[2], input: input() })
    ).rejects.toMatchObject({ code: 'payload_too_large' })
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
  })

  /** A caller may lower the ceiling but must never raise it. */
  it('clamps a caller maxBytes above the server ceiling', async () => {
    mocks.resolveContext.mockResolvedValueOnce(referenceContext({ size: 26 * 1024 * 1024 }))

    await expect(
      readWorkspaceFileText.execute({
        principal: principals[2],
        input: input({ maxBytes: 500 * 1024 * 1024 }),
      })
    ).rejects.toMatchObject({ code: 'payload_too_large' })
  })

  /**
   * A generated document stores its generation SOURCE — pdf-lib JavaScript under
   * a `.pdf` name — so parsing `file.key` by extension feeds the PDF parser a
   * script. That is a 500 on `.pdf`, and on `.docx` a "successful" extraction of
   * the generator source reported as undegraded content. Both are worse than an
   * error, because a caller cannot tell the difference.
   */
  it.each([
    ['report.pdf', 'text/x-pdflibjs'],
    ['report.pdf', 'text/x-python-pdf'],
    ['memo.docx', 'text/x-docxjs'],
    ['deck.pptx', 'text/x-pptxgenjs'],
  ])('extracts %s from its compiled artifact, not its %s source', async (name, type) => {
    const controller = new AbortController()
    mocks.resolveContext.mockResolvedValueOnce(referenceContext({ name, type, size: 900 }))
    mocks.parseBuffer.mockResolvedValueOnce({ content: 'Quarterly results', metadata: {} })

    const result = await readWorkspaceFileText.execute({
      principal: principals[2],
      input: input(),
      request: { headers: new Headers(), signal: controller.signal },
    })

    expect(mocks.fetchServable).toHaveBeenCalledTimes(1)
    expect(mocks.fetchServable.mock.calls[0][2]).toMatchObject({ signal: controller.signal })
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
    expect(mocks.parseBuffer.mock.calls[0][0].toString()).toBe('%PDF-1.7 rendered')
    expect(result.text).toBe('Quarterly results')
  })

  /**
   * The stored size of a generation source bounds nothing — it is text that
   * renders to orders of magnitude more — so the source pre-check must not be
   * what decides, and the artifact carries its own ceiling.
   */
  it('bounds a generated document by its artifact, not its source size', async () => {
    mocks.resolveContext.mockResolvedValueOnce(
      referenceContext({ name: 'report.pdf', type: 'text/x-pdflibjs', size: 900 })
    )

    await readWorkspaceFileText.execute({ principal: principals[2], input: input() })

    expect(mocks.fetchServable.mock.calls[0][2]).toMatchObject({ maxBytes: expect.any(Number) })
  })
})

vi.mock(
  '@/lib/uploads/contexts/workspace/file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)
