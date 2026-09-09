/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  assertOpaqueWorkspaceFileModelSafeMock,
  createWorkspaceFileSecretProvenanceFromRegistryMock,
  executeCopilotFileUseCaseMock,
  generateContentMock,
  resolveCopilotWorkspaceFileReferenceMock,
  writeCopilotWorkspaceFileByPathMock,
} = vi.hoisted(() => ({
  assertOpaqueWorkspaceFileModelSafeMock: vi.fn(),
  createWorkspaceFileSecretProvenanceFromRegistryMock: vi.fn(),
  executeCopilotFileUseCaseMock: vi.fn(),
  generateContentMock: vi.fn(),
  resolveCopilotWorkspaceFileReferenceMock: vi.fn(),
  writeCopilotWorkspaceFileByPathMock: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class GoogleGenAI {
    models = { generateContent: generateContentMock }
  },
}))

vi.mock('@/lib/copilot/application/execute-file-use-case', () => ({
  executeCopilotFileUseCase: (...args: unknown[]) => executeCopilotFileUseCaseMock(...args),
  resolveCopilotWorkspaceFileReference: (...args: unknown[]) =>
    resolveCopilotWorkspaceFileReferenceMock(...args),
}))

vi.mock('@/lib/copilot/generated/tool-catalog-v1', () => ({
  GenerateImage: { id: 'generate_image' },
}))

vi.mock('@/lib/copilot/tools/server/model-input', () => ({
  assertOpaqueWorkspaceFileModelSafe: (...args: unknown[]) =>
    assertOpaqueWorkspaceFileModelSafeMock(...args),
}))

vi.mock('@/lib/copilot/vfs/resource-writer', () => ({
  writeCopilotWorkspaceFileByPath: (...args: unknown[]) =>
    writeCopilotWorkspaceFileByPathMock(...args),
}))

vi.mock('@/lib/core/config/api-keys', () => ({
  getRotatingApiKey: vi.fn(() => 'api-key'),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  createWorkspaceFileSecretProvenanceFromRegistry: (...args: unknown[]) =>
    createWorkspaceFileSecretProvenanceFromRegistryMock(...args),
}))

vi.mock('@/lib/workspace-files/application/operations', () => ({
  fileOperations: { readContent: { id: 'file.readContent' } },
}))

vi.mock('@/lib/workspace-files/application/read-workspace-file-content', () => ({
  readWorkspaceFileContent: { execute: vi.fn() },
}))

import type { ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { generateImageServerTool } from '@/lib/copilot/tools/server/image/generate-image'

const context: ServerToolContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  toolCallId: 'tool-1',
  copilotToolExecution: true,
}

const referenceFile = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'reference.png',
  key: 'workspace/workspace-1/reference.png',
  path: '/api/files/serve/reference.png',
  size: 9,
  type: 'image/png',
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-08-31T00:00:00.000Z'),
  updatedAt: new Date('2026-08-31T00:00:00.000Z'),
  storageContext: 'workspace' as const,
}

describe('generateImageServerTool reference inputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveCopilotWorkspaceFileReferenceMock.mockResolvedValue(referenceFile)
    assertOpaqueWorkspaceFileModelSafeMock.mockResolvedValue(undefined)
    executeCopilotFileUseCaseMock.mockResolvedValue({
      file: referenceFile,
      content: Buffer.from('reference'),
    })
    generateContentMock.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: 'Z2VuZXJhdGVk', mimeType: 'image/png' } }],
          },
        },
      ],
    })
    createWorkspaceFileSecretProvenanceFromRegistryMock.mockResolvedValue({
      safe: true,
      provenance: { status: 'exact', entries: [] },
    })
    writeCopilotWorkspaceFileByPathMock.mockResolvedValue({
      id: 'output-1',
      name: 'generated-image.png',
      size: 9,
      contentType: 'image/png',
      vfsPath: 'files/generated-image.png',
      downloadUrl: '/api/files/serve/generated-image.png',
      mode: 'create',
    })
  })

  it('keeps inputs optional for text-to-image generation', async () => {
    const result = await generateImageServerTool.execute({ prompt: 'Draw a lighthouse' }, context)

    expect(result.success).toBe(true)
    expect(resolveCopilotWorkspaceFileReferenceMock).not.toHaveBeenCalled()
    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [
          expect.objectContaining({
            parts: [
              expect.objectContaining({ text: expect.stringContaining('Draw a lighthouse') }),
            ],
          }),
        ],
      })
    )
  })

  it.each([{ inputs: {} }, { inputs: { files: [] } }])(
    'rejects supplied inputs without files before calling the provider',
    async ({ inputs }) => {
      const result = await generateImageServerTool.execute(
        { prompt: 'Edit this image', inputs },
        context
      )

      expect(result).toEqual(
        expect.objectContaining({
          success: false,
          message: expect.stringContaining('inputs.files'),
        })
      )
      expect(generateContentMock).not.toHaveBeenCalled()
    }
  )

  it('loads a valid reference into inlineData before calling the provider', async () => {
    const result = await generateImageServerTool.execute(
      {
        prompt: 'Turn the sky purple',
        inputs: { files: [{ path: 'files/reference.png' }] },
      },
      context
    )

    expect(result.success).toBe(true)
    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [
          expect.objectContaining({
            parts: [
              { inlineData: { mimeType: 'image/png', data: 'cmVmZXJlbmNl' } },
              expect.objectContaining({ text: expect.stringContaining('Turn the sky purple') }),
            ],
          }),
        ],
      })
    )
    expect(result.message).toContain('edited')
  })

  it('fails when a reference cannot be resolved before calling the provider', async () => {
    resolveCopilotWorkspaceFileReferenceMock.mockRejectedValue(new Error('File not found'))

    const result = await generateImageServerTool.execute(
      {
        prompt: 'Edit this image',
        inputs: { files: [{ path: 'files/missing.png' }] },
      },
      context
    )

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('File not found'),
      })
    )
    expect(generateContentMock).not.toHaveBeenCalled()
  })

  it('does not generate from a partial list when any reference is missing', async () => {
    resolveCopilotWorkspaceFileReferenceMock
      .mockResolvedValueOnce(referenceFile)
      .mockRejectedValueOnce(new Error('Second file not found'))

    const result = await generateImageServerTool.execute(
      {
        prompt: 'Combine these images',
        inputs: {
          files: [{ path: 'files/reference.png' }, { path: 'files/missing.png' }],
        },
      },
      context
    )

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('Second file not found'),
      })
    )
    expect(generateContentMock).not.toHaveBeenCalled()
  })

  it('fails when reference bytes cannot be read before calling the provider', async () => {
    executeCopilotFileUseCaseMock.mockRejectedValue(new Error('Unable to read file'))

    const result = await generateImageServerTool.execute(
      {
        prompt: 'Edit this image',
        inputs: { files: [{ path: 'files/reference.png' }] },
      },
      context
    )

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('Unable to read file'),
      })
    )
    expect(generateContentMock).not.toHaveBeenCalled()
  })

  it('explains how to save an uploaded image before using it as a reference', async () => {
    const result = await generateImageServerTool.execute(
      {
        prompt: 'Edit this image',
        inputs: { files: [{ path: 'uploads/reference.png' }] },
      },
      context
    )

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringMatching(/save_upload[\s\S]*files\//),
      })
    )
    expect(resolveCopilotWorkspaceFileReferenceMock).not.toHaveBeenCalled()
    expect(generateContentMock).not.toHaveBeenCalled()
  })
})
