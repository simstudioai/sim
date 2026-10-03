import { describe, expect, it } from 'vitest'
import { TikTokBlock } from '@/blocks/blocks/tiktok'

describe('TikTokBlock', () => {
  const buildParams = TikTokBlock.tools.config.params!

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
      videoIds: 'stale-video-id',
    }
    const finalInputs = { ...inputs, ...buildParams(inputs) }

    expect(finalInputs.file).toEqual(file)
    expect(finalInputs.videoIds).toBeUndefined()
  })
})
