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
 * Resolve a Dropbox share link to a direct, embeddable video URL. Accepts only URLs
 * whose host is `dropbox.com` or a `*.dropbox.com` subdomain (so attacker-controlled
 * hosts like `dropbox.com.evil.com` are rejected), then rewrites the host to
 * `dl.dropboxusercontent.com` so the file streams as media. Returns null for any
 * non-Dropbox host or non-video path.
 */
function getDropboxDirectVideoUrl(url: string): string | null {
  const parsed = parseUrl(url)
  if (!parsed) return null
  const host = parsed.hostname.toLowerCase()
  if (host !== 'dropbox.com' && !host.endsWith('.dropbox.com')) return null
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
 */
export function getEmbedInfo(url: string): EmbedInfo | null {
  const youtubeMatch = url.match(
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
  )
  if (youtubeMatch) {
    return { url: `https://www.youtube.com/embed/${youtubeMatch[1]}`, type: 'iframe' }
  }

  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/)
  if (vimeoMatch) {
    return { url: `https://player.vimeo.com/video/${vimeoMatch[1]}`, type: 'iframe' }
  }

  const dailymotionMatch = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/)
  if (dailymotionMatch) {
    return { url: `https://www.dailymotion.com/embed/video/${dailymotionMatch[1]}`, type: 'iframe' }
  }

  const twitchVideoMatch = url.match(/twitch\.tv\/videos\/(\d+)/)
  if (twitchVideoMatch) {
    return {
      url: `https://player.twitch.tv/?video=${twitchVideoMatch[1]}&parent=${getTwitchParent()}`,
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

  const streamableMatch = url.match(/streamable\.com\/([a-zA-Z0-9]+)/)
  if (streamableMatch) {
    return { url: `https://streamable.com/e/${streamableMatch[1]}`, type: 'iframe' }
  }

  const wistiaMatch = url.match(/(?:wistia\.com|wistia\.net)\/(?:medias|embed)\/([a-zA-Z0-9]+)/)
  if (wistiaMatch) {
    return { url: `https://fast.wistia.net/embed/iframe/${wistiaMatch[1]}`, type: 'iframe' }
  }

  const tiktokMatch = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/)
  if (tiktokMatch) {
    return {
      url: `https://www.tiktok.com/embed/v2/${tiktokMatch[1]}`,
      type: 'iframe',
      aspectRatio: '9/16',
    }
  }

  const soundcloudMatch = url.match(/soundcloud\.com\/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/)
  if (soundcloudMatch) {
    return {
      url: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false`,
      type: 'iframe',
      aspectRatio: '3/2',
    }
  }

  const spotifyTrackMatch = url.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/)
  if (spotifyTrackMatch) {
    return {
      url: `https://open.spotify.com/embed/track/${spotifyTrackMatch[1]}`,
      type: 'iframe',
      aspectRatio: '3.7/1',
    }
  }

  const spotifyAlbumMatch = url.match(/open\.spotify\.com\/album\/([a-zA-Z0-9]+)/)
  if (spotifyAlbumMatch) {
    return {
      url: `https://open.spotify.com/embed/album/${spotifyAlbumMatch[1]}`,
      type: 'iframe',
      aspectRatio: '2/3',
    }
  }

  const spotifyPlaylistMatch = url.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/)
  if (spotifyPlaylistMatch) {
    return {
      url: `https://open.spotify.com/embed/playlist/${spotifyPlaylistMatch[1]}`,
      type: 'iframe',
      aspectRatio: '2/3',
    }
  }

  const spotifyEpisodeMatch = url.match(/open\.spotify\.com\/episode\/([a-zA-Z0-9]+)/)
  if (spotifyEpisodeMatch) {
    return {
      url: `https://open.spotify.com/embed/episode/${spotifyEpisodeMatch[1]}`,
      type: 'iframe',
      aspectRatio: '2.5/1',
    }
  }

  const spotifyShowMatch = url.match(/open\.spotify\.com\/show\/([a-zA-Z0-9]+)/)
  if (spotifyShowMatch) {
    return {
      url: `https://open.spotify.com/embed/show/${spotifyShowMatch[1]}`,
      type: 'iframe',
      aspectRatio: '3.7/1',
    }
  }

  const appleMusicSongMatch = url.match(/music\.apple\.com\/([a-z]{2})\/song\/[^/]+\/(\d+)/)
  if (appleMusicSongMatch) {
    const [, country, songId] = appleMusicSongMatch
    return {
      url: `https://embed.music.apple.com/${country}/song/${songId}`,
      type: 'iframe',
      aspectRatio: '3/2',
    }
  }

  const appleMusicAlbumMatch = url.match(/music\.apple\.com\/([a-z]{2})\/album\/(?:[^/]+\/)?(\d+)/)
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

  const loomMatch = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/)
  if (loomMatch) {
    return { url: `https://www.loom.com/embed/${loomMatch[1]}`, type: 'iframe' }
  }

  const facebookVideoMatch =
    url.match(/facebook\.com\/.*\/videos\/(\d+)/) || url.match(/fb\.watch\/([a-zA-Z0-9_-]+)/)
  if (facebookVideoMatch) {
    return {
      url: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false`,
      type: 'iframe',
    }
  }

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

  const twitterMatch = url.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/)
  if (twitterMatch) {
    return {
      url: `https://platform.twitter.com/embed/Tweet.html?id=${twitterMatch[1]}`,
      type: 'iframe',
      aspectRatio: '3/4',
    }
  }

  const rumbleMatch =
    url.match(/rumble\.com\/embed\/([a-zA-Z0-9]+)/) || url.match(/rumble\.com\/([a-zA-Z0-9]+)-/)
  if (rumbleMatch) {
    return { url: `https://rumble.com/embed/${rumbleMatch[1]}/`, type: 'iframe' }
  }

  const bilibiliMatch = url.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/)
  if (bilibiliMatch) {
    return {
      url: `https://player.bilibili.com/player.html?bvid=${bilibiliMatch[1]}&high_quality=1`,
      type: 'iframe',
    }
  }

  const vidyardMatch = url.match(/(?:vidyard\.com|share\.vidyard\.com)\/watch\/([a-zA-Z0-9]+)/)
  if (vidyardMatch) {
    return { url: `https://play.vidyard.com/${vidyardMatch[1]}`, type: 'iframe' }
  }

  const cfStreamMatch =
    url.match(/cloudflarestream\.com\/([a-zA-Z0-9]+)/) ||
    url.match(/videodelivery\.net\/([a-zA-Z0-9]+)/)
  if (cfStreamMatch) {
    return { url: `https://iframe.cloudflarestream.com/${cfStreamMatch[1]}`, type: 'iframe' }
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

  const mixcloudMatch = url.match(/mixcloud\.com\/([^/]+\/[^/]+)/)
  if (mixcloudMatch) {
    return {
      url: `https://www.mixcloud.com/widget/iframe/?feed=%2F${encodeURIComponent(mixcloudMatch[1])}%2F&hide_cover=1`,
      type: 'iframe',
      aspectRatio: '2/1',
    }
  }

  const googleDriveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (googleDriveMatch) {
    return { url: `https://drive.google.com/file/d/${googleDriveMatch[1]}/preview`, type: 'iframe' }
  }

  const dropboxDirectVideoUrl = getDropboxDirectVideoUrl(url)
  if (dropboxDirectVideoUrl) {
    return { url: dropboxDirectVideoUrl, type: 'video' }
  }

  const tenorMatch = url.match(/tenor\.com\/view\/[^/]+-(\d+)/)
  if (tenorMatch) {
    return { url: `https://tenor.com/embed/${tenorMatch[1]}`, type: 'iframe', aspectRatio: '1/1' }
  }

  const giphyMatch = url.match(/giphy\.com\/(?:gifs|embed)\/(?:.*-)?([a-zA-Z0-9]+)/)
  if (giphyMatch) {
    return { url: `https://giphy.com/embed/${giphyMatch[1]}`, type: 'iframe', aspectRatio: '1/1' }
  }

  if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(url)) {
    return { url, type: 'video' }
  }

  if (/\.(mp3|wav|m4a|aac)(\?|$)/i.test(url)) {
    return { url, type: 'audio' }
  }

  return null
}
