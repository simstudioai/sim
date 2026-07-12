/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchWorkspaceFileBuffer: vi.fn(),
  generateFalAudio: vi.fn(),
  generateFalVideo: vi.fn(),
  resolveChatUpload: vi.fn(),
  resolveWorkspaceFileReference: vi.fn(),
  runFfmpegOperation: vi.fn(),
  validateWorkspaceFileWriteTarget: vi.fn(),
  writeWorkspaceFileByPath: vi.fn(),
}))

vi.mock('@/lib/media/falai-audio', () => ({ generateFalAudio: mocks.generateFalAudio }))
vi.mock('@/lib/media/falai-video', () => ({ generateFalVideo: mocks.generateFalVideo }))
vi.mock('@/lib/media/ffmpeg', () => ({ runFfmpegOperation: mocks.runFfmpegOperation }))
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

import { ffmpegServerTool } from '@/lib/copilot/tools/server/media/ffmpeg'
import { generateAudioServerTool } from '@/lib/copilot/tools/server/media/generate-audio'
import { generateVideoServerTool } from '@/lib/copilot/tools/server/media/generate-video'

const CONTEXT = { userId: 'user-1', workspaceId: 'workspace-1', chatId: 'chat-1' }
const UPLOAD_RECORD = {
  id: 'wf_upload',
  name: 'start.png',
  type: 'image/png',
  storageContext: 'mothership',
}

describe('media tool path validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateWorkspaceFileWriteTarget.mockResolvedValue({})
    mocks.fetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('media'))
    mocks.generateFalVideo.mockResolvedValue({
      buffer: Buffer.from('video'),
      contentType: 'video/mp4',
      model: 'veo-3.1-fast',
      cost: { costDollars: 0.1 },
    })
    mocks.generateFalAudio.mockResolvedValue({
      buffer: Buffer.from('audio'),
      contentType: 'audio/mpeg',
      model: 'fal-ai/f5-tts',
      cost: { costDollars: 0.05 },
    })
    mocks.runFfmpegOperation.mockResolvedValue({
      buffer: Buffer.from('converted'),
      contentType: 'video/mp4',
      ext: 'mp4',
    })
    mocks.writeWorkspaceFileByPath.mockResolvedValue({
      id: 'wf_output',
      name: 'output.mp4',
      vfsPath: 'files/output.mp4',
      mode: 'create',
    })
  })

  it('passes uploads/ start frames to video generation', async () => {
    mocks.resolveChatUpload.mockResolvedValue(UPLOAD_RECORD)

    const result = await generateVideoServerTool.execute(
      {
        prompt: 'Animate this portrait',
        inputs: { files: [{ path: 'uploads/start.png' }] },
        outputs: { files: [{ path: 'files/output.mp4' }] },
      },
      CONTEXT
    )

    expect(result.success).toBe(true)
    expect(mocks.resolveChatUpload).toHaveBeenCalledWith('start.png', 'chat-1')
    expect(mocks.generateFalVideo).toHaveBeenCalledWith(
      expect.objectContaining({ imageDataUri: 'data:image/png;base64,bWVkaWE=' })
    )
  })

  it('rejects empty audio reference paths before calling the provider', async () => {
    mocks.resolveWorkspaceFileReference.mockResolvedValue(null)

    const result = await generateAudioServerTool.execute(
      {
        prompt: 'Clone this voice',
        inputs: { files: [{ path: '' }] },
        outputs: { files: [{ path: 'files/voice.mp3' }] },
      },
      CONTEXT
    )

    expect(result.success).toBe(false)
    expect(mocks.generateFalAudio).not.toHaveBeenCalled()
  })

  it('passes uploads/ voice samples to audio generation', async () => {
    mocks.resolveChatUpload.mockResolvedValue({
      ...UPLOAD_RECORD,
      name: 'voice.wav',
      type: 'audio/wav',
    })

    const result = await generateAudioServerTool.execute(
      {
        prompt: 'Read this line in the supplied voice',
        inputs: { files: [{ path: 'uploads/voice.wav' }] },
        outputs: { files: [{ path: 'files/voice.mp3' }] },
      },
      CONTEXT
    )

    expect(result.success).toBe(true)
    expect(mocks.resolveChatUpload).toHaveBeenCalledWith('voice.wav', 'chat-1')
    expect(mocks.generateFalAudio).toHaveBeenCalledWith(
      expect.objectContaining({ voiceSampleDataUri: 'data:audio/wav;base64,bWVkaWE=' })
    )
  })

  it('rejects invalid ffmpeg output paths before processing inputs', async () => {
    const result = await ffmpegServerTool.execute(
      {
        operation: 'convert',
        inputs: { files: [{ path: 'files/input.mov' }] },
        outputs: { files: [{ path: 'uploads/output.mp4' }] },
      },
      CONTEXT
    )

    expect(result.success).toBe(false)
    expect(mocks.resolveWorkspaceFileReference).not.toHaveBeenCalled()
    expect(mocks.runFfmpegOperation).not.toHaveBeenCalled()
  })

  it('ignores unused output declarations for ffmpeg probes', async () => {
    mocks.resolveWorkspaceFileReference.mockResolvedValue(UPLOAD_RECORD)
    mocks.runFfmpegOperation.mockResolvedValue({ probe: { duration: 3 } })

    const result = await ffmpegServerTool.execute(
      {
        operation: 'probe',
        inputs: { files: [{ path: 'files/input.mov' }] },
        outputs: { files: [{ path: 'uploads/unused.json' }] },
      },
      CONTEXT
    )

    expect(result.success).toBe(true)
    expect(mocks.validateWorkspaceFileWriteTarget).not.toHaveBeenCalled()
    expect(mocks.writeWorkspaceFileByPath).not.toHaveBeenCalled()
  })

  it('rejects missing generated-media outputs before calling the provider', async () => {
    const result = await generateVideoServerTool.execute(
      { prompt: 'Create a launch video' },
      CONTEXT
    )

    expect(result.success).toBe(false)
    expect(mocks.generateFalVideo).not.toHaveBeenCalled()
  })

  it('passes uploads/ media files to ffmpeg', async () => {
    mocks.resolveChatUpload.mockResolvedValue(UPLOAD_RECORD)

    const result = await ffmpegServerTool.execute(
      {
        operation: 'convert',
        inputs: { files: [{ path: 'uploads/start.png' }] },
        outputs: { files: [{ path: 'files/output.mp4' }] },
      },
      CONTEXT
    )

    expect(result.success).toBe(true)
    expect(mocks.resolveChatUpload).toHaveBeenCalledWith('start.png', 'chat-1')
    expect(mocks.runFfmpegOperation).toHaveBeenCalledWith(
      'convert',
      [expect.objectContaining({ buffer: Buffer.from('media'), name: 'start.png' })],
      expect.any(Object)
    )
  })

  it('rejects extra video inputs before calling the provider', async () => {
    const result = await generateVideoServerTool.execute(
      {
        prompt: 'Animate these portraits',
        inputs: { files: [{ path: 'files/one.png' }, { path: 'files/two.png' }] },
        outputs: { files: [{ path: 'files/output.mp4' }] },
      },
      CONTEXT
    )

    expect(result.success).toBe(false)
    expect(mocks.generateFalVideo).not.toHaveBeenCalled()
  })
})
