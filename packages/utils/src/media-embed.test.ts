import { describe, expect, it } from 'vitest'
import { getEmbedInfo } from './media-embed'

describe('getEmbedInfo', () => {
  it('only embeds when the parsed host belongs to the provider', () => {
    expect(getEmbedInfo('https://evil.com/youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(getEmbedInfo('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(getEmbedInfo('https://evil.com/open.spotify.com/track/abc123')).toBeNull()
    expect(getEmbedInfo('https://vimeo.com.evil.com/123456')).toBeNull()
    expect(getEmbedInfo('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      type: 'iframe',
    })
  })

  describe('Dropbox', () => {
    it('does not apply the Dropbox direct-link rewrite to look-alike hosts', () => {
      expect(getEmbedInfo('https://dropbox.com.evil.com/clip.mp4')?.url).not.toContain(
        'dropboxusercontent.com'
      )
      expect(getEmbedInfo('https://evil.com/?x=dropbox.com/clip.mp4')?.url).not.toContain(
        'dropboxusercontent.com'
      )
    })
  })
})
