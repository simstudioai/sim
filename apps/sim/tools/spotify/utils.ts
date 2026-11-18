import { outboundFetch } from '@/lib/core/network/outbound-fetch.server'

/** Spotify's `/me/library` endpoints accept at most this many URIs per request. */
const SPOTIFY_LIBRARY_CHUNK_SIZE = 40

type SpotifyLibraryItemType =
  | 'track'
  | 'album'
  | 'episode'
  | 'show'
  | 'audiobook'
  | 'artist'
  | 'user'
  | 'playlist'

interface SpotifyLibraryOptions {
  /** Use `GET /me/library/contains` instead of `/me/library`. */
  contains?: boolean
  /**
   * How many IDs the tool handles, matching the per-type endpoint it replaced (extra IDs are
   * ignored, as before). Omit to send every ID.
   */
  maxIds?: number
}

/** Splits a comma-separated list of Spotify IDs, dropping blanks and keeping the first `maxIds`. */
export function splitSpotifyLibraryIds(ids: string, maxIds?: number): string[] {
  const list = ids
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  return maxIds === undefined ? list : list.slice(0, maxIds)
}

/**
 * Builds one Save/Remove (`/me/library`) or Check (`/me/library/contains`) URL per 40 Spotify IDs
 * of one type. These generic endpoints replace the per-type save, remove, follow, and contains
 * endpoints Spotify removed for Development Mode apps in February 2026, and take Spotify URIs
 * (`spotify:<type>:<id>`) instead of IDs. A value that is already a Spotify URI is kept as is.
 */
function spotifyLibraryUrls(
  ids: string,
  type: SpotifyLibraryItemType,
  options: SpotifyLibraryOptions
): string[] {
  const uris = splitSpotifyLibraryIds(ids, options.maxIds).map((id) =>
    encodeURIComponent(id.startsWith('spotify:') ? id : `spotify:${type}:${id}`)
  )
  const base = `https://api.spotify.com/v1${options.contains ? '/me/library/contains' : '/me/library'}`
  const urls: string[] = []
  for (let start = 0; start < uris.length; start += SPOTIFY_LIBRARY_CHUNK_SIZE) {
    urls.push(`${base}?uris=${uris.slice(start, start + SPOTIFY_LIBRARY_CHUNK_SIZE).join(',')}`)
  }
  return urls.length > 0 ? urls : [`${base}?uris=`]
}

/** The URL for the tool's own request: the first chunk of {@link spotifyLibraryUrls}. */
export function spotifyLibraryUrl(
  ids: string,
  type: SpotifyLibraryItemType,
  options: SpotifyLibraryOptions = {}
): string {
  return spotifyLibraryUrls(ids, type, options)[0]
}

/**
 * Sends the chunks after the first one (which the tool's own request already sent) and returns
 * their `/contains` results in order, so a run with more than 40 IDs handles all of them. Throws
 * on the first rejected chunk, naming the IDs that were not handled.
 */
export async function sendRemainingSpotifyLibraryChunks(
  params: { accessToken: string },
  ids: string,
  type: SpotifyLibraryItemType,
  method: 'PUT' | 'DELETE' | 'GET',
  options: SpotifyLibraryOptions = {}
): Promise<boolean[]> {
  const results: boolean[] = []
  const urls = spotifyLibraryUrls(ids, type, options).slice(1)
  for (const [index, url] of urls.entries()) {
    const response = await outboundFetch(url, {
      method,
      headers: { Authorization: `Bearer ${params.accessToken}` },
    })
    if (!response.ok) {
      const first = (index + 1) * SPOTIFY_LIBRARY_CHUNK_SIZE + 1
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string }
      } | null
      throw new Error(
        `Spotify rejected IDs ${first}-${first + SPOTIFY_LIBRARY_CHUNK_SIZE - 1}: ${
          body?.error?.message ?? `HTTP ${response.status}`
        }`
      )
    }
    if (options.contains) {
      const chunk: unknown = await response.json()
      if (Array.isArray(chunk)) results.push(...chunk.map(Boolean))
    }
  }
  return results
}
