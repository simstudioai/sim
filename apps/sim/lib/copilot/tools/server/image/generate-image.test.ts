/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchWorkspaceFileBuffer: vi.fn(),
  generateContent: vi.fn(),
  resolveChatUpload: vi.fn(),
  resolveWorkspaceFileReference: vi.fn(),
  validateWorkspaceFileWriteTarget: vi.fn(),
  writeWorkspaceFileByPath: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent }
  },
}))

vi.mock('@/lib/core/config/api-keys', () => ({
  getRotatingApiKey: vi.fn(() => 'test-api-key'),
}))

vi.mock('@/lib/copilot/tools/handlers/upload-file-reader', () => ({
  resolveChatUpload: mocks.resolveChatUpload,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: mocks.fetchWorkspaceFileBuffer,
  resolveWorkspaceFileReference: mocks.resolveWorkspaceFileReference,
}))

vi.mock('@/lib/copilot/vfs/resource-writer', () => ({
  validateWorkspaceFileWriteTarget: mocks.validateWorkspaceFileWriteTarget,
  writeWorkspaceFileByPath: mocks.writeWorkspaceFileByPath,
}))

import { generateImageServerTool } from '@/lib/copilot/tools/server/image/generate-image'

const CONTEXT = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
}

const IMAGE_RECORD = {
  id: 'wf_image',
  workspaceId: 'workspace-1',
  name: 'person.png',
  key: 'uploads/person.png',
  path: '/api/files/serve/uploads%2Fperson.png',
  size: 3,
  type: 'image/png',
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  storageContext: 'mothership' as const,
}

describe('generateImageServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('image'))
    mocks.validateWorkspaceFileWriteTarget.mockResolvedValue({})
    mocks.generateContent.mockResolvedValue({
      candidates: [
        { content: { parts: [{ inlineData: { data: 'aW1hZ2U=', mimeType: 'image/png' } }] } },
      ],
    })
    mocks.writeWorkspaceFileByPath.mockResolvedValue({
      id: 'wf_result',
      name: 'result.png',
      vfsPath: 'files/result.png',
      mode: 'create',
      downloadUrl: '/download/result.png',
    })
  })

  it('loads a chat upload when inputs.files uses an uploads/ path', async () => {
    mocks.resolveChatUpload.mockResolvedValue(IMAGE_RECORD)

    const result = await generateImageServerTool.execute(
      {
        prompt: 'Preserve this person and put them in a library',
        inputs: { files: [{ path: 'uploads/person.png' }] },
        outputs: { files: [{ path: 'files/result.png' }] },
      },
      CONTEXT
    )

    expect(result.success).toBe(true)
    expect(mocks.resolveChatUpload).toHaveBeenCalledWith('person.png', 'chat-1')
    expect(mocks.resolveWorkspaceFileReference).not.toHaveBeenCalled()
    expect(mocks.fetchWorkspaceFileBuffer).toHaveBeenCalledWith(IMAGE_RECORD)
  })

  it('fails before generation when an input path cannot be resolved', async () => {
    mocks.resolveWorkspaceFileReference.mockResolvedValue(null)

    const result = await generateImageServerTool.execute(
      {
        prompt: 'Edit the reference image',
        inputs: { files: [{ path: 'files/missing.png' }] },
        outputs: { files: [{ path: 'files/result.png' }] },
      },
      CONTEXT
    )

    expect(result).toEqual({
      success: false,
      message: 'Failed to generate image: Input file not found: files/missing.png',
    })
    expect(mocks.generateContent).not.toHaveBeenCalled()
    expect(mocks.writeWorkspaceFileByPath).not.toHaveBeenCalled()
  })

  it('fails before generation when outputs.files targets uploads/', async () => {
    const result = await generateImageServerTool.execute(
      {
        prompt: 'Create a portrait',
        outputs: { files: [{ path: 'uploads/result.png' }] },
      },
      CONTEXT
    )

    expect(result).toEqual({
      success: false,
      message:
        'Failed to generate image: Media output paths must start with "files/"; uploads/ paths are read-only: uploads/result.png',
    })
    expect(mocks.generateContent).not.toHaveBeenCalled()
    expect(mocks.writeWorkspaceFileByPath).not.toHaveBeenCalled()
  })

  it('fails before generation when an explicit output path is empty', async () => {
    mocks.validateWorkspaceFileWriteTarget.mockRejectedValue(
      new Error('Workspace file paths must start with "files/"')
    )

    const result = await generateImageServerTool.execute(
      {
        prompt: 'Create a portrait',
        outputs: { files: [{ path: '' }] },
      },
      CONTEXT
    )

    expect(result.success).toBe(false)
    expect(mocks.generateContent).not.toHaveBeenCalled()
    expect(mocks.writeWorkspaceFileByPath).not.toHaveBeenCalled()
  })

  it('rejects additional output declarations before generation', async () => {
    const result = await generateImageServerTool.execute(
      {
        prompt: 'Create a portrait',
        outputs: {
          files: [{ path: 'files/one.png' }, { path: 'uploads/two.png' }],
        },
      },
      CONTEXT
    )

    expect(result).toEqual({
      success: false,
      message: 'Failed to generate image: Output requires exactly one file; received 2',
    })
    expect(mocks.validateWorkspaceFileWriteTarget).not.toHaveBeenCalled()
    expect(mocks.generateContent).not.toHaveBeenCalled()
  })

  it('rejects explicitly empty input and output containers before generation', async () => {
    const emptyInputs = await generateImageServerTool.execute(
      { prompt: 'Edit the supplied image', inputs: {} },
      CONTEXT
    )
    const emptyOutputs = await generateImageServerTool.execute(
      { prompt: 'Create a portrait', outputs: {} },
      CONTEXT
    )

    expect(emptyInputs).toEqual({
      success: false,
      message: 'Failed to generate image: Input requires at least one file',
    })
    expect(emptyOutputs).toEqual({
      success: false,
      message: 'Failed to generate image: Output requires exactly one file; received 0',
    })
    expect(mocks.generateContent).not.toHaveBeenCalled()
  })

  it('fails before generation when canonical output preflight rejects a files/ target', async () => {
    mocks.validateWorkspaceFileWriteTarget.mockRejectedValue(
      new Error('File already exists at files/result.png')
    )

    const result = await generateImageServerTool.execute(
      {
        prompt: 'Create a portrait',
        outputs: { files: [{ path: 'files/result.png' }] },
      },
      CONTEXT
    )

    expect(result.success).toBe(false)
    expect(mocks.generateContent).not.toHaveBeenCalled()
    expect(mocks.writeWorkspaceFileByPath).not.toHaveBeenCalled()
  })
})
