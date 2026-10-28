import { workspaceFileSecretProvenanceMock } from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { observeServiceCosts } from '@/lib/mothership/billing/service-observer'

const {
  mockGenerateContent,
  mockGenerateFalAudio,
  mockGenerateFalVideo,
  mockWriteWorkspaceFileByPath,
} = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
  mockGenerateFalAudio: vi.fn(),
  mockGenerateFalVideo: vi.fn(),
  mockWriteWorkspaceFileByPath: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class GoogleGenAI {
    models = { generateContent: mockGenerateContent }
  },
}))
vi.mock('@/lib/core/config/api-keys', () => ({ getRotatingApiKey: vi.fn(() => 'api-key') }))
vi.mock('@/lib/mothership/vfs/resource-writer', () => ({
  validateCopilotWorkspaceFileWriteTarget: vi.fn(),
  writeCopilotWorkspaceFileByPath: mockWriteWorkspaceFileByPath,
}))
vi.mock('@/lib/media/falai-audio', () => ({ generateFalAudio: mockGenerateFalAudio }))
vi.mock('@/lib/media/falai-video', () => ({ generateFalVideo: mockGenerateFalVideo }))
vi.mock(
  '@/lib/uploads/contexts/workspace/file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)

import type { ServerToolContext } from '@/lib/mothership/tools/server/base-tool'
import { generateImageServerTool } from '@/lib/mothership/tools/server/image/generate-image'
import { generateAudioServerTool } from '@/lib/mothership/tools/server/media/generate-audio'
import { generateVideoServerTool } from '@/lib/mothership/tools/server/media/generate-video'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

interface FalGenerationParams {
  signal?: AbortSignal
  onCost: (cost: { costDollars: number }) => Promise<void>
}

/** A fal generation that bills 0.1 through `onCost`, then returns `media` with that cost. */
function billsThen(media: Record<string, unknown>) {
  return async ({ onCost }: FalGenerationParams) => {
    const cost = { costDollars: 0.1 }
    await onCost(cost)
    return { ...media, cost }
  }
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
    mockGenerateFalVideo.mockImplementation(
      billsThen({ buffer: Buffer.from('video'), contentType: 'video/mp4', model: 'veo-3.1-fast' })
    )
    mockGenerateFalAudio.mockImplementation(
      billsThen({
        buffer: Buffer.from('audio'),
        contentType: 'audio/mpeg',
        type: 'music',
        model: 'music-model',
      })
    )
  })

  it('meters image, video and audio at their provider boundary before file persistence', async () => {
    const context = contextWithSecrets([])
    const charges = vi.fn().mockResolvedValue(undefined)
    await observeServiceCosts(charges, async () => {
      await generateImageServerTool.execute({ prompt: 'image' }, context)
      await generateVideoServerTool.execute({ prompt: 'video' }, context)
      await generateAudioServerTool.execute({ prompt: 'audio', type: 'music' }, context)
    })
    expect(charges.mock.calls).toEqual([
      ['nano_banana_2', 0.101],
      ['falai_video', 0.1],
      ['falai_audio', 0.1],
    ])
  })

  it.each([
    ['audio', () => mockGenerateFalAudio, generateAudioServerTool],
    ['video', () => mockGenerateFalVideo, generateVideoServerTool],
  ] as const)(
    'ends the %s generation when the tool call is aborted',
    async (_kind, generator, tool) => {
      generator().mockImplementationOnce(
        ({ signal }: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            if (signal?.aborted) return reject(signal.reason)
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
      )
      const controller = new AbortController()
      const result = tool.execute(
        { prompt: 'p' },
        { ...contextWithSecrets([]), abortSignal: controller.signal }
      )

      controller.abort(new Error('Tool timed out'))

      await expect(result).resolves.toMatchObject({ success: false })
    }
  )

  it.each([
    ['audio', 'falai_audio', mockGenerateFalAudio, generateAudioServerTool],
    ['video', 'falai_video', mockGenerateFalVideo, generateVideoServerTool],
  ] as const)(
    'bills a completed %s generation once when the tool call is aborted after it',
    async (_kind, service, generator, tool) => {
      generator.mockImplementationOnce(async ({ onCost }: FalGenerationParams) => {
        await onCost({ costDollars: 0.2 })
        throw new Error('Tool timed out')
      })
      const charges = vi.fn().mockResolvedValue(undefined)

      const result = await observeServiceCosts(charges, () =>
        tool.execute({ prompt: 'p' }, contextWithSecrets([]))
      )

      expect(result).toMatchObject({ success: false })
      expect(charges.mock.calls).toEqual([[service, 0.2]])
    }
  )

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
})
