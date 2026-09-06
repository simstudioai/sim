/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchServable: vi.fn(),
  fetchBuffer: vi.fn(),
  parseBuffer: vi.fn(),
  resolvePermission: vi.fn(),
  resolveContext: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workspace-files/application/resolve-workspace-file-reference', () => ({
  resolveReferencedWorkspaceFileContext: mocks.resolveContext,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  fetchWorkspaceFileBuffer: mocks.fetchBuffer,
}))

vi.mock('@/lib/workspace-files/application/fetch-servable-workspace-file-buffer', () => ({
  fetchAuthorizedServableWorkspaceFileBuffer: mocks.fetchServable,
}))

vi.mock('@/lib/file-parsers', () => ({
  isSupportedFileType: (extension: string) =>
    ['txt', 'pdf', 'doc', 'docx', 'pptx'].includes(extension),
  parseBuffer: mocks.parseBuffer,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { DocCompileUserError } from '@/lib/mothership/tools/server/files/doc-compile-error'
import { readWorkspaceFileText } from '@/lib/workspace-files/application/read-workspace-file-text'

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
  { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
  { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-personal' },
  { kind: 'workspace_api_key', workspaceId: WORKSPACE_ID, keyId: 'key-workspace' },
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

/** The canonical context the reference resolver hands back, carrying the record it resolved. */
function referenceContext(overrides: Record<string, unknown> = {}) {
  return { ...fileContext, file: fileRecord(overrides) }
}

function input(overrides: Record<string, unknown> = {}) {
  return { workspaceId: WORKSPACE_ID, reference: FILE_ID, ...overrides }
}

describe('readWorkspaceFileText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveContext.mockResolvedValue(referenceContext())
    mocks.fetchBuffer.mockResolvedValue(Buffer.from('hello there!'))
    mocks.fetchServable.mockResolvedValue({
      buffer: Buffer.from('%PDF-1.7 rendered'),
      contentType: 'application/pdf',
    })
    mocks.parseBuffer.mockResolvedValue({ content: 'hello there!', metadata: {} })
  })

  it.each(principals)('allows $kind at the read role', async (principal) => {
    const result = await readWorkspaceFileText.execute({ principal, input: input() })

    expect(result.text).toBe('hello there!')
    expect(result.degraded).toBe(false)
    expect(result.truncated).toBe(false)
  })

  /**
   * `parseBuffer` signals every failure as a bare `Error`, which no v2 policy
   * classifies — so calling it unguarded turned a zero-byte upload or a
   * mislabelled archive into a `500` on a well-formed request.
   */
  it('answers empty text for a zero-byte file instead of failing', async () => {
    mocks.fetchBuffer.mockResolvedValue(Buffer.alloc(0))

    const result = await readWorkspaceFileText.execute({ principal: principals[0], input: input() })

    expect(result.text).toBe('')
    expect(mocks.parseBuffer).not.toHaveBeenCalled()
  })

  it('classifies unparseable bytes as a conflict rather than an unhandled error', async () => {
    mocks.parseBuffer.mockRejectedValue(new Error('Unsupported file type'))

    await expect(
      readWorkspaceFileText.execute({ principal: principals[0], input: input() })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('denies a principal below the read role', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    await expect(
      readWorkspaceFileText.execute({ principal: principals[0], input: input() })
    ).rejects.toThrow()
    expect(mocks.parseBuffer).not.toHaveBeenCalled()
  })

  it('resolves the file canonically before authorizing or reading', async () => {
    mocks.resolveContext.mockRejectedValueOnce(
      Object.assign(new Error('File not found'), { code: 'not_found' })
    )

    await expect(
      readWorkspaceFileText.execute({ principal: principals[2], input: input() })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
  })

  /**
   * The reference is what makes a chat upload readable: no listing shows one, so
   * the `uploads/<name>` path from its upload notice must resolve with chat
   * uploads admitted, and the record's display name is what comes back.
   */
  it('resolves the reference with chat uploads admitted and reads the resolved record', async () => {
    mocks.resolveContext.mockResolvedValueOnce(
      referenceContext({ id: 'wf_upload', name: 'notes (2).txt', storageContext: 'mothership' })
    )

    const result = await readWorkspaceFileText.execute({
      principal: principals[2],
      input: input({ reference: 'uploads/notes%20(2).txt' }),
    })

    expect(mocks.resolveContext).toHaveBeenCalledWith(
      principals[2],
      { workspaceId: WORKSPACE_ID, reference: 'uploads/notes%20(2).txt' },
      { includeChatUploads: true }
    )
    expect(result.file.name).toBe('notes (2).txt')
    expect(mocks.fetchBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wf_upload', storageContext: 'mothership' }),
      expect.anything()
    )
    expect(result.text).toBe('hello there!')
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

  it('surfaces a text-free deck as degraded', async () => {
    mocks.resolveContext.mockResolvedValueOnce(referenceContext({ name: 'deck.pptx' }))
    mocks.parseBuffer.mockResolvedValueOnce({
      content: 'Unable to extract text from PowerPoint file.',
      metadata: { degraded: true, warning: 'Basic text extraction used' },
    })

    const result = await readWorkspaceFileText.execute({ principal: principals[2], input: input() })

    expect(result.degraded).toBe(true)
  })

  it('reports no degraded reason for a clean extraction', async () => {
    const result = await readWorkspaceFileText.execute({ principal: principals[2], input: input() })

    expect(result.degraded).toBe(false)
    expect(result.degradedReason).toBeNull()
  })

  it('reports parser truncation', async () => {
    mocks.parseBuffer.mockResolvedValueOnce({
      content: 'partial',
      metadata: { truncated: true },
    })

    const result = await readWorkspaceFileText.execute({ principal: principals[2], input: input() })

    expect(result.truncated).toBe(true)
  })

  /**
   * The message is served to raw HTTP, Copilot, and the CLI alike, so it names
   * the remedy rather than an endpoint only one of those three can call.
   */
  it('rejects an unsupported type and names the raw-bytes escape hatch', async () => {
    mocks.resolveContext.mockResolvedValue(referenceContext({ name: 'photo.heic' }))

    await expect(
      readWorkspaceFileText.execute({ principal: principals[2], input: input() })
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('download the raw bytes'),
    })
    await expect(
      readWorkspaceFileText.execute({ principal: principals[2], input: input() })
    ).rejects.toMatchObject({ message: expect.not.stringMatching(/\/api\/v2\//) })
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

  it('honours a caller maxBytes below the server ceiling', async () => {
    mocks.resolveContext.mockResolvedValueOnce(referenceContext({ size: 2048 }))

    await expect(
      readWorkspaceFileText.execute({ principal: principals[2], input: input({ maxBytes: 1024 }) })
    ).rejects.toMatchObject({ code: 'payload_too_large' })
  })

  /**
   * Both numbers are sub-1 KB, which the default size formatting renders as
   * "0 Bytes" — leaving the caller unable to work out what to pass instead.
   */
  it('names the real size and limit when both are under 1 KB', async () => {
    mocks.resolveContext.mockResolvedValueOnce(referenceContext({ size: 28 }))

    await expect(
      readWorkspaceFileText.execute({ principal: principals[2], input: input({ maxBytes: 27 }) })
    ).rejects.toMatchObject({
      code: 'payload_too_large',
      message: expect.stringContaining('is 28 Bytes, above the 27 Bytes'),
    })
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
  })

  it('reports a missing file as not found', async () => {
    mocks.resolveContext.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'File not found')
    )

    await expect(
      readWorkspaceFileText.execute({ principal: principals[2], input: input() })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('propagates a storage failure rather than concealing it', async () => {
    mocks.fetchBuffer.mockRejectedValueOnce(new Error('s3 unavailable'))

    await expect(
      readWorkspaceFileText.execute({ principal: principals[2], input: input() })
    ).rejects.toThrow('s3 unavailable')
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
    mocks.resolveContext.mockResolvedValueOnce(referenceContext({ name, type, size: 900 }))
    mocks.parseBuffer.mockResolvedValueOnce({ content: 'Quarterly results', metadata: {} })

    const result = await readWorkspaceFileText.execute({ principal: principals[2], input: input() })

    expect(mocks.fetchServable).toHaveBeenCalledTimes(1)
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
    expect(mocks.parseBuffer.mock.calls[0][0].toString()).toBe('%PDF-1.7 rendered')
    expect(result.text).toBe('Quarterly results')
  })

  /** A genuinely uploaded PDF carries its real MIME and must keep reading its own bytes. */
  it('reads an uploaded pdf from storage rather than an artifact', async () => {
    mocks.resolveContext.mockResolvedValueOnce(
      referenceContext({ name: 'scan.pdf', type: 'application/pdf', size: 900 })
    )

    await readWorkspaceFileText.execute({ principal: principals[2], input: input() })

    expect(mocks.fetchBuffer).toHaveBeenCalledTimes(1)
    expect(mocks.fetchServable).not.toHaveBeenCalled()
  })

  /** An artifact still compiling is retryable, so it must not read as a fault. */
  it('reports a still-compiling artifact as a conflict', async () => {
    mocks.resolveContext.mockResolvedValueOnce(
      referenceContext({ name: 'report.pdf', type: 'text/x-pdflibjs', size: 900 })
    )
    mocks.fetchServable.mockRejectedValueOnce(
      new DocCompileUserError('not ready', { pending: true })
    )

    await expect(
      readWorkspaceFileText.execute({ principal: principals[2], input: input() })
    ).rejects.toMatchObject({ code: 'conflict' })
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

  /**
   * The artifact branch renders the same caller-supplied ceiling, so it needs
   * the same exact-byte formatting the source branch does.
   */
  it('names a sub-1 KB artifact limit in bytes', async () => {
    mocks.resolveContext.mockResolvedValueOnce(
      referenceContext({ name: 'report.pdf', type: 'text/x-pdflibjs', size: 10 })
    )
    mocks.fetchServable.mockRejectedValueOnce(
      new PayloadSizeLimitError({ label: 'artifact', maxBytes: 27 })
    )

    await expect(
      readWorkspaceFileText.execute({ principal: principals[2], input: input({ maxBytes: 27 }) })
    ).rejects.toMatchObject({
      code: 'payload_too_large',
      message: expect.stringContaining('renders to more than 27 Bytes'),
    })
  })
})
