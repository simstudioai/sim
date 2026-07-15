/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TikTokBlock } from '@/blocks/blocks/tiktok'

describe('TikTokBlock', () => {
  const buildParams = TikTokBlock.tools.config.params!
  const selectTool = TikTokBlock.tools.config.tool!

  it('keeps direct posting unavailable until one-use human approval is supported', () => {
    expect(TikTokBlock.tools.access).not.toContain('tiktok_direct_post_video')
    expect(() => selectTool({ operation: 'tiktok_direct_post_video' })).toThrow(
      'Unsupported TikTok operation'
    )
  })

  it('uses one canonical file parameter for upload and reference modes', () => {
    const fileInputs = TikTokBlock.subBlocks.filter(
      (subBlock) => subBlock.id === 'videoFile' || subBlock.id === 'videoFileRef'
    )

    expect(fileInputs).toHaveLength(2)
    expect(fileInputs.every((subBlock) => subBlock.canonicalParamId === 'file')).toBe(true)
  })

  it('forwards only draft parameters and preserves a canonical UserFile', () => {
    const file = {
      id: 'file-1',
      key: 'workspace/workspace-1/file-1',
      name: 'video.mp4',
      size: 1024,
      type: 'video/mp4',
      url: '/api/files/serve?key=workspace%2Fworkspace-1%2Ffile-1',
    }

    const inputs = {
      operation: 'tiktok_upload_video_draft',
      file,
      privacyLevel: 'PUBLIC_TO_EVERYONE',
      musicUsageConsent: 'accepted',
      videoIds: 'stale-video-id',
    }
    const finalInputs = { ...inputs, ...buildParams(inputs) }

    expect(finalInputs.file).toEqual(file)
    expect(finalInputs.privacyLevel).toBeUndefined()
    expect(finalInputs.musicUsageConsent).toBeUndefined()
    expect(finalInputs.videoIds).toBeUndefined()
  })

  it('declares file-like outputs with canonical block output types', () => {
    expect(TikTokBlock.outputs.avatarFile.type).toBe('file')
    expect(TikTokBlock.outputs.creatorAvatarFile.type).toBe('file')
    expect(TikTokBlock.outputs.videos.type).toBe('array')
    expect(TikTokBlock.outputs.publiclyAvailablePostId.type).toBe('array')
  })
})
