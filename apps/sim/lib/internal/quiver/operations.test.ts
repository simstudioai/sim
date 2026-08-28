/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadFileFromStorage: vi.fn(),
  isModelSafeWorkspaceFileKey: vi.fn(),
  processFilesToUserFiles: vi.fn(),
  requestQuiverSvg: vi.fn(),
}))

vi.mock('@/lib/internal/quiver/client', () => ({ requestQuiverSvg: mocks.requestQuiverSvg }))
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: mocks.processFilesToUserFiles,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: mocks.downloadFileFromStorage,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mocks.isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
}))

import { executeQuiverImageToSvg, executeQuiverTextToSvg } from '@/lib/internal/quiver/operations'

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

describe('Quiver operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.downloadFileFromStorage.mockResolvedValue(Buffer.from([1, 2, 3]))
    mocks.isModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mocks.processFilesToUserFiles.mockImplementation((files: unknown[]) => files)
    mocks.requestQuiverSvg.mockResolvedValue({
      data: [{ svg: '<svg>one</svg>' }, { svg: '<svg>two</svg>' }],
      id: 'generation-1',
      usage: { total_tokens: 9, input_tokens: 4, output_tokens: 5 },
    })
  })

  it('authorizes, checks, and cumulatively bounds stored references', async () => {
    mocks.downloadFileFromStorage
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
      { ...context, signal: controller.signal }
    )

    expect(mocks.assertToolFileAccess).toHaveBeenCalledTimes(2)
    expect(mocks.isModelSafeWorkspaceFileKey).toHaveBeenCalledTimes(2)
    expect(mocks.downloadFileFromStorage).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'request-1',
      expect.anything(),
      { maxBytes: MAX_BUFFERED_TRANSFER_BYTES }
    )
    expect(mocks.downloadFileFromStorage).toHaveBeenNthCalledWith(
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
    expect(result.output).toMatchObject({
      file: { name: 'generated-1.svg', mimeType: 'image/svg+xml' },
      files: [{ name: 'generated-1.svg' }, { name: 'generated-2.svg' }],
      svgContent: '<svg>one</svg>',
      id: 'generation-1',
      usage: { totalTokens: 9, inputTokens: 4, outputTokens: 5 },
    })
  })

  it('preserves image URL inputs without reading local files', async () => {
    const result = await executeQuiverImageToSvg(
      {
        apiKey: 'secret',
        model: 'arrow-preview',
        image: 'https://images.example.com/source.png',
        auto_crop: false,
        target_size: 512,
      },
      context
    )

    expect(mocks.assertToolFileAccess).not.toHaveBeenCalled()
    expect(mocks.requestQuiverSvg).toHaveBeenCalledWith(
      'vectorizations',
      'secret',
      {
        model: 'arrow-preview',
        image: { url: 'https://images.example.com/source.png' },
        auto_crop: false,
        target_size: 512,
      },
      undefined
    )
    expect(result.output.file.name).toBe('vectorized.svg')
    expect(result.output.files).toHaveLength(1)
    expect(result.output.svgContent).toBe('<svg>one</svg>')
  })

  it('authorizes stored image inputs and sends their bytes', async () => {
    await executeQuiverImageToSvg(
      { apiKey: 'secret', model: 'arrow-preview', image: rawFile },
      context
    )

    expect(mocks.assertToolFileAccess).toHaveBeenCalledWith(
      rawFile.key,
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.downloadFileFromStorage).toHaveBeenCalledWith(
      expect.anything(),
      'request-1',
      expect.anything(),
      { maxBytes: MAX_BUFFERED_TRANSFER_BYTES }
    )
    expect(mocks.requestQuiverSvg).toHaveBeenCalledWith(
      'vectorizations',
      'secret',
      { model: 'arrow-preview', image: { base64: 'AQID' } },
      undefined
    )
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
    expect(mocks.assertToolFileAccess).not.toHaveBeenCalled()
    expect(mocks.requestQuiverSvg).not.toHaveBeenCalled()
  })

  it('rejects model-unsafe stored files before downloading them', async () => {
    mocks.isModelSafeWorkspaceFileKey.mockResolvedValue(false)

    await expect(
      executeQuiverImageToSvg({ apiKey: 'secret', model: 'arrow-preview', image: rawFile }, context)
    ).rejects.toMatchObject({
      status: 400,
      body: {
        success: false,
        error: 'File cannot be sent to a model because its secret provenance is unavailable',
      },
    })
    expect(mocks.downloadFileFromStorage).not.toHaveBeenCalled()
    expect(mocks.requestQuiverSvg).not.toHaveBeenCalled()
  })

  it('preserves the empty-provider-result error', async () => {
    mocks.requestQuiverSvg.mockResolvedValue({ data: [] })

    await expect(
      executeQuiverTextToSvg(
        { apiKey: 'secret', model: 'arrow-preview', prompt: 'A compass' },
        context
      )
    ).rejects.toMatchObject({
      status: 500,
      body: { success: false, error: 'No SVG data returned from Quiver API' },
    })
  })
})
