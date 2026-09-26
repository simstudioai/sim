import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
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
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const mocks = vi.hoisted(() => ({
  requestQuiverSvg: vi.fn(),
}))

vi.mock('@/lib/internal/quiver/client', () => ({ requestQuiverSvg: mocks.requestQuiverSvg }))
vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)
vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)

import { executeQuiverImageToSvg, executeQuiverTextToSvg } from '@/lib/internal/quiver/operations'

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockDownloadFileFromStorage } = fileUtilsServerMockFns
const { mockProcessFilesToUserFiles } = fileUtilsMockFns
const { mockIsModelSafeWorkspaceFileKey } = workspaceFileSecretProvenanceMockFns

const rawFile = {
  key: 'workspace/workspace-1/image.png',
  name: 'image.png',
  size: 3,
  type: 'image/png',
}

const context = {
  headers: new Headers(),
  requestId: 'request-1',
  userId: 'user-1',
}

function storedSvg(name: string) {
  return {
    id: name,
    name,
    size: 14,
    type: 'image/svg+xml',
    mimeType: 'image/svg+xml',
    url: `/api/files/${name}`,
    key: `execution/${name}`,
    context: 'execution' as const,
  }
}

describe('Quiver operations', () => {
  beforeEach(() => {
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadFileFromStorage.mockResolvedValue(Buffer.from([1, 2, 3]))
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mockProcessFilesToUserFiles.mockImplementation((files: unknown[]) => files)
    mocks.requestQuiverSvg.mockResolvedValue({
      data: [{ svg: '<svg>one</svg>' }, { svg: '<svg>two</svg>' }],
      id: 'generation-1',
      usage: { total_tokens: 9, input_tokens: 4, output_tokens: 5 },
    })
  })

  it('authorizes, checks, and cumulatively bounds stored references', async () => {
    mockDownloadFileFromStorage
      .mockResolvedValueOnce(Buffer.from([1, 2, 3]))
      .mockResolvedValueOnce(Buffer.from([4, 5]))
    const controller = new AbortController()

    const result = await executeQuiverTextToSvg(
      {
        apiKey: 'secret',
        model: 'arrow-preview',
        prompt: 'A compass',
        instructions: 'Minimal',
        references: [rawFile, { ...rawFile, key: 'workspace/workspace-1/second.png' }],
        n: 2,
        temperature: 0.5,
      },
      { ...context, signal: controller.signal },
      'v2'
    )

    expect(mockAssertToolFileAccess).toHaveBeenCalledTimes(2)
    expect(mockIsModelSafeWorkspaceFileKey).toHaveBeenCalledTimes(2)
    expect(mockDownloadFileFromStorage).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'request-1',
      expect.anything(),
      { maxBytes: MAX_BUFFERED_TRANSFER_BYTES }
    )
    expect(mockDownloadFileFromStorage).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'request-1',
      expect.anything(),
      { maxBytes: MAX_BUFFERED_TRANSFER_BYTES - 3 }
    )
    expect(mocks.requestQuiverSvg).toHaveBeenCalledWith(
      'generations',
      'secret',
      {
        model: 'arrow-preview',
        prompt: 'A compass',
        instructions: 'Minimal',
        references: [{ base64: 'AQID' }, { base64: 'BAU=' }],
        n: 2,
        temperature: 0.5,
      },
      controller.signal
    )
    expect(result.files).toHaveLength(2)
    const storedFiles = [storedSvg('generated-1.svg'), storedSvg('generated-2.svg')]
    const presented = result.present(storedFiles) as { output: { files: unknown[] } }
    expect(presented.output.files).toBe(storedFiles)
    expect(presented.output).toMatchObject({
      files: [{ name: 'generated-1.svg' }, { name: 'generated-2.svg' }],
      id: 'generation-1',
      usage: { totalTokens: 9, inputTokens: 4, outputTokens: 5 },
    })
    expect(Object.keys(presented.output).sort()).toEqual(['files', 'id', 'usage'])
    expect(presented.output).not.toHaveProperty('svgContent')
  })

  it('fails closed on incomplete private model-input provenance', async () => {
    const headers = new Headers({
      [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })

    await expect(
      executeQuiverImageToSvg(
        {
          apiKey: 'secret',
          model: 'arrow-preview',
          image: rawFile,
          [RESOLVED_SECRET_PROVENANCE_FIELD]: { version: 1, complete: false, entries: [] },
        },
        { ...context, headers }
      )
    ).rejects.toMatchObject({
      status: 400,
      body: { success: false, error: 'Model input provenance is unavailable' },
    })
    expect(mockAssertToolFileAccess).not.toHaveBeenCalled()
    expect(mocks.requestQuiverSvg).not.toHaveBeenCalled()
  })

  it('rejects model-unsafe stored files before downloading them', async () => {
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(false)

    await expect(
      executeQuiverImageToSvg({ apiKey: 'secret', model: 'arrow-preview', image: rawFile }, context)
    ).rejects.toMatchObject({
      status: 400,
      body: {
        success: false,
        error: 'File cannot be sent to a model because its secret provenance is unavailable',
      },
    })
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
    expect(mocks.requestQuiverSvg).not.toHaveBeenCalled()
  })
})
