import { describe, expect, it } from 'vitest'
import { getEmbedInfo } from './media-embed'

describe('getEmbedInfo', () => {
  it('maps YouTube watch/short/embed URLs to the embed iframe', () => {
    const expected = { url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', type: 'iframe' }
    expect(getEmbedInfo('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual(expected)
    expect(getEmbedInfo('https://youtu.be/dQw4w9WgXcQ')).toEqual(expected)
    expect(getEmbedInfo('https://www.youtube.com/embed/dQw4w9WgXcQ')).toEqual(expected)
    // Extra query params around v=, a youtu.be tracking param, a trailing slash,
    // and an embed query string all still resolve to the same embed.
    expect(getEmbedInfo('https://www.youtube.com/watch?list=RD&v=dQw4w9WgXcQ&t=5')).toEqual(
      expected
    )
    expect(getEmbedInfo('https://youtu.be/dQw4w9WgXcQ?si=abc')).toEqual(expected)
    expect(getEmbedInfo('https://youtu.be/dQw4w9WgXcQ/')).toEqual(expected)
    expect(getEmbedInfo('https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0')).toEqual(expected)
    // A non-11-char id is not a valid YouTube video and does not embed.
    expect(getEmbedInfo('https://www.youtube.com/watch?v=short')).toBeNull()
  })

  it('maps Facebook and fb.watch video links to the video plugin', () => {
    expect(getEmbedInfo('https://www.facebook.com/some.page/videos/1234567890')).toEqual({
      url: 'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fsome.page%2Fvideos%2F1234567890&show_text=false',
      type: 'iframe',
    })
    expect(getEmbedInfo('https://fb.watch/abc123')?.type).toBe('iframe')
    expect(getEmbedInfo('https://www.facebook.com/some.page/about')).toBeNull()
  })

  it('extracts the Giphy id from the trailing slug token', () => {
    const expected = { url: 'https://giphy.com/embed/abc123', type: 'iframe', aspectRatio: '1/1' }
    expect(getEmbedInfo('https://giphy.com/gifs/funny-cat-abc123')).toEqual(expected)
    expect(getEmbedInfo('https://giphy.com/embed/abc123')).toEqual(expected)
  })

  it('maps Vimeo and Spotify URLs with their aspect ratios', () => {
    expect(getEmbedInfo('https://vimeo.com/123456')).toEqual({
      url: 'https://player.vimeo.com/video/123456',
      type: 'iframe',
    })
    expect(getEmbedInfo('https://open.spotify.com/track/abc123')).toEqual({
      url: 'https://open.spotify.com/embed/track/abc123',
      type: 'iframe',
      aspectRatio: '3.7/1',
    })
  })

  it('treats bare media file extensions as native video/audio', () => {
    expect(getEmbedInfo('https://cdn.example.com/clip.mp4')).toEqual({
      url: 'https://cdn.example.com/clip.mp4',
      type: 'video',
    })
    expect(getEmbedInfo('https://cdn.example.com/sound.mp3')).toEqual({
      url: 'https://cdn.example.com/sound.mp3',
      type: 'audio',
    })
  })

  it('returns null for non-embeddable URLs', () => {
    expect(getEmbedInfo('https://example.com/article')).toBeNull()
    expect(getEmbedInfo('not a url')).toBeNull()
  })

  it('only embeds when the parsed host belongs to the provider', () => {
    // A provider domain in the path or as a subdomain prefix of an attacker host
    // must not be treated as that provider.
    expect(getEmbedInfo('https://evil.com/youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(getEmbedInfo('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(getEmbedInfo('https://evil.com/open.spotify.com/track/abc123')).toBeNull()
    expect(getEmbedInfo('https://vimeo.com.evil.com/123456')).toBeNull()
    // Legitimate subdomains of a provider still embed.
    expect(getEmbedInfo('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      type: 'iframe',
    })
  })

  describe('Dropbox', () => {
    it('rewrites a Dropbox video share link to a direct streamable URL', () => {
      expect(getEmbedInfo('https://www.dropbox.com/s/abc/clip.mp4?dl=0')).toEqual({
        url: 'https://dl.dropboxusercontent.com/s/abc/clip.mp4',
        type: 'video',
      })
    })

    it('handles non-www and scheme-less Dropbox hosts', () => {
      expect(getEmbedInfo('https://m.dropbox.com/s/abc/clip.mov')).toEqual({
        url: 'https://dl.dropboxusercontent.com/s/abc/clip.mov',
        type: 'video',
      })
      expect(getEmbedInfo('dropbox.com/s/abc/clip.webm')).toEqual({
        url: 'https://dl.dropboxusercontent.com/s/abc/clip.webm',
        type: 'video',
      })
    })

    it('does not apply the Dropbox direct-link rewrite to look-alike hosts', () => {
      // Look-alike hosts fall through to the generic video handler with their
      // original (untrusted) host intact — never rewritten as if trusted Dropbox.
      expect(getEmbedInfo('https://dropbox.com.evil.com/clip.mp4')?.url).not.toContain(
        'dropboxusercontent.com'
      )
      expect(getEmbedInfo('https://evil.com/?x=dropbox.com/clip.mp4')?.url).not.toContain(
        'dropboxusercontent.com'
      )
    })
  })
})
