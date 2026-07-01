/**
 * Resolved embed for a media URL: the iframe/video/audio source to render plus
 * an optional aspect ratio hint. Renderers own the surrounding markup; this
 * module only decides whether a URL is embeddable and what source to use.
 */
export interface EmbedInfo {
  url: string
  type: 'iframe' | 'video' | 'audio'
  aspectRatio?: string
}

/**
 * The `parent` query param required by Twitch embeds. Reads the current host in
 * the browser and falls back to `localhost` during SSR.
 */
function getTwitchParent(): string {
  return typeof window !== 'undefined' ? window.location.hostname : 'localhost'
}

/** Parse a URL, tolerating scheme-less inputs (https is assumed). Returns null if unparseable. */
function parseUrl(url: string): URL | null {
  for (const candidate of [url, `https://${url}`]) {
    try {
      return new URL(candidate)
    } catch {}
  }
  return null
}

/**
 * Whether `host` is one of `domains` or a subdomain of one (e.g. `m.youtube.com`
 * matches `youtube.com`). A null host (unparseable URL) never matches. This is the
 * security boundary for provider detection: a link is only treated as a given
 * platform when its parsed host actually belongs to that platform, so look-alikes
 * like `youtube.com.evil.com` or `evil.com/youtube.com/...` are rejected.
 */
function hostMatches(host: string | null, ...domains: string[]): boolean {
  if (host === null) return false
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

/**
 * Rewrite a Dropbox share URL's host to `dl.dropboxusercontent.com` so the file
 * streams as media, returning null for a non-video path. The caller has already
 * verified the host is Dropbox.
 */
function toDropboxDirectVideoUrl(parsed: URL): string | null {
  if (!/\.(mp4|mov|webm)$/i.test(parsed.pathname)) return null
  parsed.hostname = 'dl.dropboxusercontent.com'
  parsed.searchParams.delete('dl')
  return parsed.toString()
}

/**
 * Map a URL to its embeddable form across supported media platforms (YouTube,
 * Vimeo, Spotify, Apple Music, Twitch, Dropbox, Giphy, and many more), plus
 * generic video/audio file extensions. Returns null when the URL is not a
 * recognized embeddable source.
 *
 * Each platform is gated on its parsed hostname via {@link hostMatches} before its
 * id-extracting regex runs. The generic file-extension fallbacks are intentionally
 * host-agnostic — any direct media file URL is embeddable.
 */
export function getEmbedInfo(url: string): EmbedInfo | null {
  const parsed = parseUrl(url)
  const host = parsed?.hostname.toLowerCase() ?? null
  if (parsed && hostMatches(host, 'youtube.com', 'youtu.be')) {
    const id = hostMatches(host, 'youtu.be')
      ? parsed.pathname.split('/')[1]
      : (parsed.searchParams.get('v') ?? parsed.pathname.match(/^\/embed\/([^/?]+)/)?.[1])
    if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
      return { url: `https://www.youtube.com/embed/${id}`, type: 'iframe' }
    }
  }

  if (hostMatches(host, 'vimeo.com')) {
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/)
    if (vimeoMatch) {
      return { url: `https://player.vimeo.com/video/${vimeoMatch[1]}`, type: 'iframe' }
    }
  }

  if (hostMatches(host, 'dailymotion.com')) {
    const dailymotionMatch = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/)
    if (dailymotionMatch) {
      return {
        url: `https://www.dailymotion.com/embed/video/${dailymotionMatch[1]}`,
        type: 'iframe',
      }
    }
  }

  if (hostMatches(host, 'twitch.tv')) {
    const twitchVideoMatch = url.match(/twitch\.tv\/videos\/(\d+)/)
    if (twitchVideoMatch) {
      return {
        url: `https://player.twitch.tv/?video=${twitchVideoMatch[1]}&parent=${getTwitchParent()}`,
        type: 'iframe',
      }
    }

    const twitchClipMatch =
      url.match(/clips\.twitch\.tv\/([a-zA-Z0-9_-]+)/) ||
      url.match(/twitch\.tv\/[^/]+\/clip\/([a-zA-Z0-9_-]+)/)
    if (twitchClipMatch) {
      return {
        url: `https://clips.twitch.tv/embed?clip=${twitchClipMatch[1]}&parent=${getTwitchParent()}`,
        type: 'iframe',
      }
    }

    const twitchChannelMatch = url.match(/twitch\.tv\/([a-zA-Z0-9_]+)(?:\/|$)/)
    if (twitchChannelMatch && !url.includes('/videos/') && !url.includes('/clip/')) {
      return {
        url: `https://player.twitch.tv/?channel=${twitchChannelMatch[1]}&parent=${getTwitchParent()}`,
        type: 'iframe',
      }
    }
  }

  if (hostMatches(host, 'streamable.com')) {
    const streamableMatch = url.match(/streamable\.com\/([a-zA-Z0-9]+)/)
    if (streamableMatch) {
      return { url: `https://streamable.com/e/${streamableMatch[1]}`, type: 'iframe' }
    }
  }

  if (hostMatches(host, 'wistia.com', 'wistia.net')) {
    const wistiaMatch = url.match(/(?:wistia\.com|wistia\.net)\/(?:medias|embed)\/([a-zA-Z0-9]+)/)
    if (wistiaMatch) {
      return { url: `https://fast.wistia.net/embed/iframe/${wistiaMatch[1]}`, type: 'iframe' }
    }
  }

  if (hostMatches(host, 'tiktok.com')) {
    const tiktokMatch = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/)
    if (tiktokMatch) {
      return {
        url: `https://www.tiktok.com/embed/v2/${tiktokMatch[1]}`,
        type: 'iframe',
        aspectRatio: '9/16',
      }
    }
  }

  if (hostMatches(host, 'soundcloud.com')) {
    const soundcloudMatch = url.match(/soundcloud\.com\/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/)
    if (soundcloudMatch) {
      return {
        url: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false`,
        type: 'iframe',
        aspectRatio: '3/2',
      }
    }
  }

  if (hostMatches(host, 'spotify.com')) {
    const spotifyMatch = url.match(
      /open\.spotify\.com\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/
    )
    if (spotifyMatch) {
      const [, kind, id] = spotifyMatch
      const aspectRatio =
        kind === 'track' || kind === 'show' ? '3.7/1' : kind === 'episode' ? '2.5/1' : '2/3'
      return { url: `https://open.spotify.com/embed/${kind}/${id}`, type: 'iframe', aspectRatio }
    }
  }

  if (hostMatches(host, 'apple.com')) {
    const appleMusicSongMatch = url.match(/music\.apple\.com\/([a-z]{2})\/song\/[^/]+\/(\d+)/)
    if (appleMusicSongMatch) {
      const [, country, songId] = appleMusicSongMatch
      return {
        url: `https://embed.music.apple.com/${country}/song/${songId}`,
        type: 'iframe',
        aspectRatio: '3/2',
      }
    }

    const appleMusicAlbumMatch = url.match(
      /music\.apple\.com\/([a-z]{2})\/album\/(?:[^/]+\/)?(\d+)/
    )
    if (appleMusicAlbumMatch) {
      const [, country, albumId] = appleMusicAlbumMatch
      return {
        url: `https://embed.music.apple.com/${country}/album/${albumId}`,
        type: 'iframe',
        aspectRatio: '2/3',
      }
    }

    const appleMusicPlaylistMatch = url.match(
      /music\.apple\.com\/([a-z]{2})\/playlist\/[^/]+\/(pl\.[a-zA-Z0-9]+)/
    )
    if (appleMusicPlaylistMatch) {
      const [, country, playlistId] = appleMusicPlaylistMatch
      return {
        url: `https://embed.music.apple.com/${country}/playlist/${playlistId}`,
        type: 'iframe',
        aspectRatio: '2/3',
      }
    }
  }

  if (hostMatches(host, 'loom.com')) {
    const loomMatch = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/)
    if (loomMatch) {
      return { url: `https://www.loom.com/embed/${loomMatch[1]}`, type: 'iframe' }
    }
  }

  if (parsed && hostMatches(host, 'facebook.com', 'fb.watch')) {
    const isFacebookVideo = hostMatches(host, 'fb.watch')
      ? /^\/[a-zA-Z0-9_-]+/.test(parsed.pathname)
      : /\/videos\/\d+/.test(parsed.pathname)
    if (isFacebookVideo) {
      return {
        url: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false`,
        type: 'iframe',
      }
    }
  }

  if (hostMatches(host, 'instagram.com')) {
    const instagramReelMatch = url.match(/instagram\.com\/reel\/([a-zA-Z0-9_-]+)/)
    if (instagramReelMatch) {
      return {
        url: `https://www.instagram.com/reel/${instagramReelMatch[1]}/embed`,
        type: 'iframe',
        aspectRatio: '9/16',
      }
    }

    const instagramPostMatch = url.match(/instagram\.com\/p\/([a-zA-Z0-9_-]+)/)
    if (instagramPostMatch) {
      return {
        url: `https://www.instagram.com/p/${instagramPostMatch[1]}/embed`,
        type: 'iframe',
        aspectRatio: '4/5',
      }
    }
  }

  if (hostMatches(host, 'twitter.com', 'x.com')) {
    const twitterMatch = url.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/)
    if (twitterMatch) {
      return {
        url: `https://platform.twitter.com/embed/Tweet.html?id=${twitterMatch[1]}`,
        type: 'iframe',
        aspectRatio: '3/4',
      }
    }
  }

  if (hostMatches(host, 'rumble.com')) {
    const rumbleMatch =
      url.match(/rumble\.com\/embed\/([a-zA-Z0-9]+)/) || url.match(/rumble\.com\/([a-zA-Z0-9]+)-/)
    if (rumbleMatch) {
      return { url: `https://rumble.com/embed/${rumbleMatch[1]}/`, type: 'iframe' }
    }
  }

  if (hostMatches(host, 'bilibili.com')) {
    const bilibiliMatch = url.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/)
    if (bilibiliMatch) {
      return {
        url: `https://player.bilibili.com/player.html?bvid=${bilibiliMatch[1]}&high_quality=1`,
        type: 'iframe',
      }
    }
  }

  if (hostMatches(host, 'vidyard.com')) {
    const vidyardMatch = url.match(/(?:vidyard\.com|share\.vidyard\.com)\/watch\/([a-zA-Z0-9]+)/)
    if (vidyardMatch) {
      return { url: `https://play.vidyard.com/${vidyardMatch[1]}`, type: 'iframe' }
    }
  }

  if (hostMatches(host, 'cloudflarestream.com', 'videodelivery.net')) {
    const cfStreamMatch =
      url.match(/cloudflarestream\.com\/([a-zA-Z0-9]+)/) ||
      url.match(/videodelivery\.net\/([a-zA-Z0-9]+)/)
    if (cfStreamMatch) {
      return { url: `https://iframe.cloudflarestream.com/${cfStreamMatch[1]}`, type: 'iframe' }
    }
  }

  if (hostMatches(host, 'mixcloud.com')) {
    const mixcloudMatch = url.match(/mixcloud\.com\/([^/]+\/[^/]+)/)
    if (mixcloudMatch) {
      return {
        url: `https://www.mixcloud.com/widget/iframe/?feed=%2F${encodeURIComponent(mixcloudMatch[1])}%2F&hide_cover=1`,
        type: 'iframe',
        aspectRatio: '2/1',
      }
    }
  }

  if (hostMatches(host, 'google.com')) {
    const googleDriveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/)
    if (googleDriveMatch) {
      return {
        url: `https://drive.google.com/file/d/${googleDriveMatch[1]}/preview`,
        type: 'iframe',
      }
    }
  }

  if (parsed && hostMatches(host, 'dropbox.com')) {
    const dropboxDirectVideoUrl = toDropboxDirectVideoUrl(parsed)
    if (dropboxDirectVideoUrl) {
      return { url: dropboxDirectVideoUrl, type: 'video' }
    }
  }

  if (hostMatches(host, 'tenor.com')) {
    const tenorMatch = url.match(/tenor\.com\/view\/[^/]+-(\d+)/)
    if (tenorMatch) {
      return { url: `https://tenor.com/embed/${tenorMatch[1]}`, type: 'iframe', aspectRatio: '1/1' }
    }
  }

  if (parsed && hostMatches(host, 'giphy.com')) {
    // Giphy ids are the trailing hyphen-delimited token of a /gifs/ or /embed/ path segment.
    const segment = parsed.pathname.match(/^\/(?:gifs|embed)\/([^/]+)/)?.[1]
    const giphyId = segment?.split('-').pop()
    if (giphyId && /^[a-zA-Z0-9]+$/.test(giphyId)) {
      return { url: `https://giphy.com/embed/${giphyId}`, type: 'iframe', aspectRatio: '1/1' }
    }
  }

  if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(url)) {
    return { url, type: 'video' }
  }

  if (/\.(mp3|wav|m4a|aac)(\?|$)/i.test(url)) {
    return { url, type: 'audio' }
  }

  return null
}
