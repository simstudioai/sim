/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGenerateContent,
  mockGenerateFalAudio,
  mockGenerateFalVideo,
  mockIsOpaqueWorkspaceFileEgressSafe,
  mockResolveWorkspaceFileReference,
  mockReadWorkspaceFileContent,
  mockWriteWorkspaceFileByPath,
} = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
  mockGenerateFalAudio: vi.fn(),
  mockGenerateFalVideo: vi.fn(),
  mockIsOpaqueWorkspaceFileEgressSafe: vi.fn(),
  mockResolveWorkspaceFileReference: vi.fn(),
  mockReadWorkspaceFileContent: vi.fn(),
  mockWriteWorkspaceFileByPath: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class GoogleGenAI {
    models = { generateContent: mockGenerateContent }
  },
}))
vi.mock('@/lib/core/config/api-keys', () => ({ getRotatingApiKey: vi.fn(() => 'api-key') }))
vi.mock('@/lib/mothership/vfs/resource-writer', () => ({
  writeCopilotWorkspaceFileByPath: mockWriteWorkspaceFileByPath,
}))
vi.mock('@/lib/media/falai-audio', () => ({ generateFalAudio: mockGenerateFalAudio }))
vi.mock('@/lib/media/falai-video', () => ({ generateFalVideo: mockGenerateFalVideo }))
vi.mock('@/lib/workspace-files/application/resolve-workspace-file-reference', () => ({
  resolveWorkspaceFileReference: mockResolveWorkspaceFileReference,
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-content', () => ({
  readWorkspaceFileContent: { execute: mockReadWorkspaceFileContent },
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isOpaqueWorkspaceFileEgressSafe: mockIsOpaqueWorkspaceFileEgressSafe,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
}))

import type { ServerToolContext } from '@/lib/mothership/tools/server/base-tool'
import { generateImageServerTool } from '@/lib/mothership/tools/server/image/generate-image'
import { generateAudioServerTool } from '@/lib/mothership/tools/server/media/generate-audio'
import { generateVideoServerTool } from '@/lib/mothership/tools/server/media/generate-video'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const file = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'reference.png',
  key: 'workspace/workspace-1/reference.png',
  path: '/api/files/serve/reference.png',
  size: 10,
  type: 'image/png',
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-08-05T00:00:00.000Z'),
  updatedAt: new Date('2026-08-05T00:00:00.000Z'),
  storageContext: 'workspace' as const,
}

function contextWithSecrets(
  entries: Array<{ name: string; plaintext: string }>
): ServerToolContext {
  const registry = new ResolvedSecretTraceRegistry(
    entries.map((entry) => ({ ...entry, encryptedValue: `encrypted-${entry.name}` }))
  )
  for (const entry of entries) registry.recordResolved(entry.name, entry.plaintext)
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    toolCallId: 'tool-1',
    copilotToolExecution: true,
    resolvedSecretTraceRegistry: registry,
  }
}

describe('Mothership media model boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsOpaqueWorkspaceFileEgressSafe.mockResolvedValue(true)
    mockResolveWorkspaceFileReference.mockResolvedValue(file)
    mockReadWorkspaceFileContent.mockResolvedValue({ file, content: Buffer.from('opaque-media') })
    mockWriteWorkspaceFileByPath.mockResolvedValue({
      id: 'output-1',
      name: 'output.bin',
      size: 10,
      contentType: 'application/octet-stream',
      vfsPath: 'files/output.bin',
      mode: 'create',
    })
    mockGenerateContent.mockResolvedValue({
      candidates: [
        { content: { parts: [{ inlineData: { data: 'aW1hZ2U=', mimeType: 'image/png' } }] } },
      ],
    })
    mockGenerateFalVideo.mockResolvedValue({
      buffer: Buffer.from('video'),
      contentType: 'video/mp4',
      model: 'veo-3.1-fast',
      cost: { costDollars: 0.1 },
    })
    mockGenerateFalAudio.mockResolvedValue({
      buffer: Buffer.from('audio'),
      contentType: 'audio/mpeg',
      type: 'music',
      model: 'music-model',
      cost: { costDollars: 0.1 },
    })
  })

  it('preserves image prompts that merely collide with ambient secret plaintext', async () => {
    const context = contextWithSecrets([{ name: 'PROMPT', plaintext: 'private prompt' }])

    await generateImageServerTool.execute({ prompt: 'private prompt' }, context)

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [
          expect.objectContaining({
            parts: [expect.objectContaining({ text: expect.stringContaining('private prompt') })],
          }),
        ],
      })
    )
    expect(JSON.stringify(mockGenerateContent.mock.calls[0]?.[0])).toContain('private prompt')
    expect(JSON.stringify(mockGenerateContent.mock.calls[0]?.[0])).not.toContain('{{PROMPT}}')
  })

  it('preserves video prompt fields that merely collide with ambient secret plaintext', async () => {
    const context = contextWithSecrets([
      { name: 'PROMPT', plaintext: 'private prompt' },
      { name: 'NEGATIVE', plaintext: 'private negative prompt' },
    ])

    await generateVideoServerTool.execute(
      { prompt: 'private prompt', negativePrompt: 'private negative prompt' },
      context
    )

    expect(mockGenerateFalVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'private prompt',
        negativePrompt: 'private negative prompt',
      })
    )
  })

  it('preserves audio prompt fields that merely collide with ambient secret plaintext', async () => {
    const context = contextWithSecrets([
      { name: 'PROMPT', plaintext: 'private prompt' },
      { name: 'LYRICS', plaintext: 'private lyrics' },
    ])

    await generateAudioServerTool.execute(
      { prompt: 'private prompt', type: 'music', lyrics: 'private lyrics' },
      context
    )

    expect(mockGenerateFalAudio).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'private prompt', lyrics: 'private lyrics' })
    )
  })

  it.each([
    [
      'image',
      () =>
        generateImageServerTool.execute(
          { prompt: 'safe', inputs: { files: [{ path: 'files/reference.png' }] } },
          contextWithSecrets([])
        ),
    ],
    [
      'video',
      () =>
        generateVideoServerTool.execute(
          { prompt: 'safe', inputs: { files: [{ path: 'files/reference.png' }] } },
          contextWithSecrets([])
        ),
    ],
    [
      'audio',
      () =>
        generateAudioServerTool.execute(
          { prompt: 'safe', inputs: { files: [{ path: 'files/reference.mp3' }] } },
          contextWithSecrets([])
        ),
    ],
  ])(
    'rejects unsafe %s references before fetching bytes or calling a model',
    async (_name, run) => {
      mockIsOpaqueWorkspaceFileEgressSafe.mockResolvedValue(false)

      await expect(run()).resolves.toEqual(
        expect.objectContaining({
          success: false,
          message: expect.stringContaining('cannot be sent'),
        })
      )

      expect(mockReadWorkspaceFileContent).not.toHaveBeenCalled()
      expect(mockGenerateContent).not.toHaveBeenCalled()
      expect(mockGenerateFalVideo).not.toHaveBeenCalled()
      expect(mockGenerateFalAudio).not.toHaveBeenCalled()
    }
  )
})
