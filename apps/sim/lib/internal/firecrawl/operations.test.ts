/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
  isModelSafeWorkspaceFileKey: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFileFromStorage,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mocks.isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE: 'File is not model-safe',
}))

import { executeFirecrawlParse } from '@/lib/internal/firecrawl/operations'

const FILE = {
  key: 'workspace/workspace-1/document.pdf',
  name: 'document.pdf',
  size: 42,
  type: 'application/pdf',
}

function createContext(headers = new Headers()) {
  return { headers, userId: 'user-1', requestId: 'request-1' }
}

describe('executeFirecrawlParse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.isModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('document'),
      contentType: 'application/pdf',
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ data: { markdown: '# Parsed' }, creditsUsed: 2 }, { status: 200 })
        )
    )
  })

  it('authorizes and parses a model-safe file once while retaining credits', async () => {
    const response = await executeFirecrawlParse(
      { apiKey: 'firecrawl-key', file: FILE, options: { formats: ['markdown'] } },
      createContext()
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      output: { markdown: '# Parsed', creditsUsed: 2 },
    })
    expect(mocks.assertToolFileAccess).toHaveBeenCalledOnce()
    expect(mocks.isModelSafeWorkspaceFileKey).toHaveBeenCalledWith(FILE.key)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects incomplete private provenance before file or provider work', async () => {
    const headers = new Headers({
      [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })
    const response = await executeFirecrawlParse(
      {
        apiKey: 'firecrawl-key',
        file: FILE,
        options: { formats: ['markdown'] },
        [RESOLVED_SECRET_PROVENANCE_FIELD]: { version: 1, complete: false, entries: [] },
      },
      createContext(headers)
    )

    expect(response.status).toBe(400)
    expect(mocks.assertToolFileAccess).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects model-unsafe files before reading bytes', async () => {
    mocks.isModelSafeWorkspaceFileKey.mockResolvedValue(false)
    const response = await executeFirecrawlParse(
      { apiKey: 'firecrawl-key', file: FILE, options: { formats: ['markdown'] } },
      createContext()
    )

    expect(response.status).toBe(400)
    expect(mocks.downloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('forwards cancellation to Firecrawl', async () => {
    const controller = new AbortController()
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      throw init?.signal?.reason
    })

    await expect(
      executeFirecrawlParse(
        { apiKey: 'firecrawl-key', file: FILE, options: {} },
        { ...createContext(), signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
