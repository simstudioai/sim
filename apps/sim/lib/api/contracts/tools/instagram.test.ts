/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  instagramCarouselMediaSchema,
  instagramDownloadMediaOutputSchema,
} from '@/lib/api/contracts/tools/instagram'

const userFile = {
  id: 'file-1',
  name: 'image.jpg',
  url: '/api/files/serve/execution/image.jpg',
  size: 10,
  type: 'image/jpeg',
  key: 'execution/workflow-1/execution-1/image.jpg',
  context: 'execution',
}

describe('Instagram tool contracts', () => {
  it('accepts only 2-10 carousel files', () => {
    expect(instagramCarouselMediaSchema.safeParse([userFile]).success).toBe(false)
    expect(instagramCarouselMediaSchema.safeParse([userFile, userFile]).success).toBe(true)
    expect(instagramCarouselMediaSchema.safeParse(Array(11).fill(userFile)).success).toBe(false)
    expect(instagramCarouselMediaSchema.safeParse('https://example.com/one.jpg').success).toBe(
      false
    )
    expect(
      instagramCarouselMediaSchema.safeParse(
        'https://example.com/one.jpg,https://example.com/two.jpg'
      ).success
    ).toBe(true)
  })

  it('requires 1-10 downloaded files in successful output', () => {
    expect(
      instagramDownloadMediaOutputSchema.safeParse({
        files: [],
        mediaId: 'media-1',
        mediaType: 'IMAGE',
        downloadedCount: 1,
      }).success
    ).toBe(false)
    expect(
      instagramDownloadMediaOutputSchema.safeParse({
        files: [userFile],
        mediaId: 'media-1',
        mediaType: 'IMAGE',
        downloadedCount: 1,
      }).success
    ).toBe(true)
    expect(
      instagramDownloadMediaOutputSchema.safeParse({
        files: [userFile],
        mediaId: 'media-1',
        mediaType: 'IMAGE',
        downloadedCount: 2,
      }).success
    ).toBe(false)
  })
})
