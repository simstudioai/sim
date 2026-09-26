import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns
const { mockIsModelSafeWorkspaceFileKey } = workspaceFileSecretProvenanceMockFns

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
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mockDownloadServableFileFromStorage.mockResolvedValue({
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
    expect(mockAssertToolFileAccess).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects model-unsafe files before reading bytes', async () => {
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(false)
    const response = await executeFirecrawlParse(
      { apiKey: 'firecrawl-key', file: FILE, options: { formats: ['markdown'] } },
      createContext()
    )

    expect(response.status).toBe(400)
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
