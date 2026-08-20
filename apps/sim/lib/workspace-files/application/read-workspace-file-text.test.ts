/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getFile: vi.fn(),
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

vi.mock('@/lib/workspace-files/application/workspace-file-context', () => ({
  resolveActiveWorkspaceFileContext: mocks.resolveContext,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  fetchWorkspaceFileBuffer: mocks.fetchBuffer,
  getWorkspaceFile: mocks.getFile,
}))

vi.mock('@/lib/file-parsers', () => ({
  isSupportedFileType: (extension: string) =>
    ['txt', 'pdf', 'doc', 'docx', 'pptx'].includes(extension),
  parseBuffer: mocks.parseBuffer,
}))

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

function input(overrides: Record<string, unknown> = {}) {
  return { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID, ...overrides }
}

describe('readWorkspaceFileText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveContext.mockResolvedValue(fileContext)
    mocks.getFile.mockResolvedValue(fileRecord())
    mocks.fetchBuffer.mockResolvedValue(Buffer.from('hello there!'))
    mocks.parseBuffer.mockResolvedValue({ content: 'hello there!', metadata: {} })
  })

  it.each(principals)('allows $kind at the read role', async (principal) => {
    const result = await readWorkspaceFileText.execute({ principal, input: input() })

    expect(result.text).toBe('hello there!')
    expect(result.degraded).toBe(false)
    expect(result.truncated).toBe(false)
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
    expect(mocks.getFile).not.toHaveBeenCalled()
  })

  /**
   * The whole hazard this endpoint exists to avoid: the legacy parsers return
   * placeholder or scraped content instead of throwing, so `degraded` must
   * reach the caller rather than being swallowed or turned into an error.
   */
  it('surfaces a degraded legacy extraction with its reason', async () => {
    mocks.getFile.mockResolvedValueOnce(fileRecord({ name: 'legacy.doc' }))
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
    mocks.getFile.mockResolvedValueOnce(fileRecord({ name: 'deck.pptx' }))
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

  it('rejects an unsupported type and names the raw-bytes escape hatch', async () => {
    mocks.getFile.mockResolvedValueOnce(fileRecord({ name: 'photo.heic' }))

    await expect(
      readWorkspaceFileText.execute({ principal: principals[2], input: input() })
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining(`GET /api/v2/files/${FILE_ID}`),
    })
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
  })

  it('rejects a source above the extraction ceiling before reading bytes', async () => {
    mocks.getFile.mockResolvedValueOnce(fileRecord({ size: 26 * 1024 * 1024 }))

    await expect(
      readWorkspaceFileText.execute({ principal: principals[2], input: input() })
    ).rejects.toMatchObject({ code: 'payload_too_large' })
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
  })

  /** A caller may lower the ceiling but must never raise it. */
  it('clamps a caller maxBytes above the server ceiling', async () => {
    mocks.getFile.mockResolvedValueOnce(fileRecord({ size: 26 * 1024 * 1024 }))

    await expect(
      readWorkspaceFileText.execute({
        principal: principals[2],
        input: input({ maxBytes: 500 * 1024 * 1024 }),
      })
    ).rejects.toMatchObject({ code: 'payload_too_large' })
  })

  it('honours a caller maxBytes below the server ceiling', async () => {
    mocks.getFile.mockResolvedValueOnce(fileRecord({ size: 2048 }))

    await expect(
      readWorkspaceFileText.execute({ principal: principals[2], input: input({ maxBytes: 1024 }) })
    ).rejects.toMatchObject({ code: 'payload_too_large' })
  })

  it('reports a missing file as not found', async () => {
    mocks.getFile.mockResolvedValueOnce(null)

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
})
