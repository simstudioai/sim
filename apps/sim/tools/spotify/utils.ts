/** Spotify's `/me/library` endpoints accept at most this many URIs per request. */
const SPOTIFY_LIBRARY_MAX_URIS = 40

type SpotifyLibraryItemType =
  | 'track'
  | 'album'
  | 'episode'
  | 'show'
  | 'audiobook'
  | 'artist'
  | 'user'
  | 'playlist'

/**
 * Splits a comma-separated list of Spotify IDs, dropping blanks and keeping the first
 * {@link SPOTIFY_LIBRARY_MAX_URIS}, the most one `/me/library` request accepts.
 */
export function splitSpotifyLibraryIds(ids: string): string[] {
  return ids
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, SPOTIFY_LIBRARY_MAX_URIS)
}

/**
 * Builds a Save/Remove (`/me/library`) or Check (`/me/library/contains`) URL for Spotify IDs of
 * one type. These generic endpoints replace the per-type save, remove, follow, and contains
 * endpoints Spotify removed for Development Mode apps in February 2026, and take Spotify URIs
 * (`spotify:<type>:<id>`) instead of IDs. A value that is already a Spotify URI is kept as is.
 */
export function spotifyLibraryUrl(
  ids: string,
  type: SpotifyLibraryItemType,
  options: { contains?: boolean } = {}
): string {
  const uris = splitSpotifyLibraryIds(ids)
    .map((id) => (id.startsWith('spotify:') ? id : `spotify:${type}:${id}`))
    .map(encodeURIComponent)
    .join(',')
  const path = options.contains ? '/me/library/contains' : '/me/library'
  return `https://api.spotify.com/v1${path}?uris=${uris}`
}
