import type { ToolResponse } from '@/tools/types'

/**
 * Base params that include OAuth access token
 */
export interface SpotifyBaseParams {
  accessToken: string
}

/**
 * Common Spotify objects
 */
export interface SpotifyImage {
  url: string
  height: number | null
  width: number | null
}

export interface SpotifyExternalUrls {
  spotify: string
}

export interface SpotifyArtistSimplified {
  id: string
  name: string
  external_urls: SpotifyExternalUrls
}

export interface SpotifyAlbumSimplified {
  id: string
  name: string
  album_type: string
  total_tracks: number
  release_date: string
  images: SpotifyImage[]
  artists: SpotifyArtistSimplified[]
  external_urls: SpotifyExternalUrls
}

export interface SpotifyTrack {
  id: string
  name: string
  duration_ms: number
  explicit: boolean
  popularity: number
  preview_url: string | null
  track_number: number
  disc_number: number
  album: SpotifyAlbumSimplified
  artists: SpotifyArtistSimplified[]
  external_urls: SpotifyExternalUrls
  uri: string
}

export interface SpotifyArtist {
  id: string
  name: string
  genres: string[]
  popularity: number
  followers: { total: number }
  images: SpotifyImage[]
  external_urls: SpotifyExternalUrls
}

export interface SpotifyAlbum {
  id: string
  name: string
  album_type: string
  total_tracks: number
  release_date: string
  release_date_precision: string
  label: string
  popularity: number
  genres: string[]
  images: SpotifyImage[]
  artists: SpotifyArtistSimplified[]
  tracks: {
    items: SpotifyTrack[]
    total: number
  }
  external_urls: SpotifyExternalUrls
}

export interface SpotifyPlaylist {
  id: string
  name: string
  description: string | null
  public: boolean
  collaborative: boolean
  owner: {
    id: string
    display_name: string
  }
  images: SpotifyImage[]
  tracks: {
    total: number
  }
  external_urls: SpotifyExternalUrls
  snapshot_id: string
}

export interface SpotifyPlaylistTrack {
  added_at: string
  added_by: {
    id: string
  }
  track: SpotifyTrack
}

export interface SpotifyUser {
  id: string
  display_name: string
  email?: string
  country?: string
  product?: string
  followers: { total: number }
  images: SpotifyImage[]
  external_urls: SpotifyExternalUrls
}

export interface SpotifyDevice {
  id: string
  is_active: boolean
  is_private_session: boolean
  is_restricted: boolean
  name: string
  type: string
  volume_percent: number
}

export interface SpotifyPlaybackState {
  device: SpotifyDevice
  shuffle_state: boolean
  repeat_state: string
  timestamp: number
  progress_ms: number
  is_playing: boolean
  item: SpotifyTrack | null
  currently_playing_type: string
}

/**
 * Search
 */
export interface SpotifySearchParams extends SpotifyBaseParams {
  query: string
  type?: string
  limit?: number
  offset?: number
  market?: string
}

export interface SpotifySearchResponse extends ToolResponse {
  output: {
    tracks: Array<{
      id: string
      name: string
      artists: string[]
      album: string
      duration_ms: number
      popularity: number
      preview_url: string | null
      external_url: string
    }>
    artists: Array<{
      id: string
      name: string
      genres: string[]
      popularity: number
      followers: number
      image_url: string | null
      external_url: string
    }>
    albums: Array<{
      id: string
      name: string
      artists: string[]
      total_tracks: number
      release_date: string
      image_url: string | null
      external_url: string
    }>
    playlists: Array<{
      id: string
      name: string
      description: string | null
      owner: string
      total_tracks: number
      image_url: string | null
      external_url: string
    }>
  }
}

/**
 * Get Track
 */
export interface SpotifyGetTrackParams extends SpotifyBaseParams {
  trackId: string
  market?: string
}

export interface SpotifyGetTrackResponse extends ToolResponse {
  output: {
    id: string
    name: string
    artists: Array<{ id: string; name: string }>
    album: {
      id: string
      name: string
      image_url: string | null
    }
    duration_ms: number
    explicit: boolean
    popularity: number
    preview_url: string | null
    external_url: string
    uri: string
  }
}

/**
 * Get Multiple Tracks
 */
export interface SpotifyGetTracksParams extends SpotifyBaseParams {
  trackIds: string
  market?: string
}

export interface SpotifyGetTracksResponse extends ToolResponse {
  output: {
    tracks: Array<{
      id: string
      name: string
      artists: Array<{ id: string; name: string }>
      album: {
        id: string
        name: string
        image_url: string | null
      }
      duration_ms: number
      explicit: boolean
      popularity: number
      preview_url: string | null
      external_url: string
    }>
  }
}

/**
 * Get Album
 */
export interface SpotifyGetAlbumParams extends SpotifyBaseParams {
  albumId: string
  market?: string
}

export interface SpotifyGetAlbumResponse extends ToolResponse {
  output: {
    id: string
    name: string
    artists: Array<{ id: string; name: string }>
    album_type: string
    total_tracks: number
    release_date: string
    label: string
    popularity: number
    genres: string[]
    image_url: string | null
    tracks: Array<{
      id: string
      name: string
      duration_ms: number
      track_number: number
    }>
    external_url: string
  }
}

/**
 * Get Album Tracks
 */
export interface SpotifyGetAlbumTracksParams extends SpotifyBaseParams {
  albumId: string
  limit?: number
  offset?: number
  market?: string
}

export interface SpotifyGetAlbumTracksResponse extends ToolResponse {
  output: {
    tracks: Array<{
      id: string
      name: string
      artists: Array<{ id: string; name: string }>
      duration_ms: number
      track_number: number
      disc_number: number
      explicit: boolean
      preview_url: string | null
    }>
    total: number
    next: string | null
  }
}

/**
 * Get Artist
 */
export interface SpotifyGetArtistParams extends SpotifyBaseParams {
  artistId: string
}

export interface SpotifyGetArtistResponse extends ToolResponse {
  output: {
    id: string
    name: string
    genres: string[]
    popularity: number
    followers: number
    image_url: string | null
    external_url: string
  }
}

/**
 * Get Artist Albums
 */
export interface SpotifyGetArtistAlbumsParams extends SpotifyBaseParams {
  artistId: string
  include_groups?: string
  limit?: number
  offset?: number
  market?: string
}

export interface SpotifyGetArtistAlbumsResponse extends ToolResponse {
  output: {
    albums: Array<{
      id: string
      name: string
      album_type: string
      total_tracks: number
      release_date: string
      image_url: string | null
      external_url: string
    }>
    total: number
    next: string | null
  }
}

/**
 * Get Artist Top Tracks
 */
export interface SpotifyGetArtistTopTracksParams extends SpotifyBaseParams {
  artistId: string
  market?: string
}

export interface SpotifyGetArtistTopTracksResponse extends ToolResponse {
  output: {
    tracks: Array<{
      id: string
      name: string
      album: {
        id: string
        name: string
        image_url: string | null
      }
      duration_ms: number
      popularity: number
      preview_url: string | null
      external_url: string
    }>
  }
}

/**
 * Get Playlist
 */
export interface SpotifyGetPlaylistParams extends SpotifyBaseParams {
  playlistId: string
  market?: string
}

export interface SpotifyGetPlaylistResponse extends ToolResponse {
  output: {
    id: string
    name: string
    description: string | null
    public: boolean
    collaborative: boolean
    owner: {
      id: string
      display_name: string
    }
    image_url: string | null
    total_tracks: number
    snapshot_id: string
    external_url: string
  }
}

/**
 * Get Playlist Tracks
 */
export interface SpotifyGetPlaylistTracksParams extends SpotifyBaseParams {
  playlistId: string
  limit?: number
  offset?: number
  market?: string
}

export interface SpotifyGetPlaylistTracksResponse extends ToolResponse {
  output: {
    tracks: Array<{
      added_at: string
      added_by: string
      track: {
        id: string
        name: string
        artists: Array<{ id: string; name: string }>
        album: {
          id: string
          name: string
          image_url: string | null
        }
        duration_ms: number
        popularity: number
        external_url: string
      }
    }>
    total: number
    next: string | null
  }
}

/**
 * Get User Playlists
 */
export interface SpotifyGetUserPlaylistsParams extends SpotifyBaseParams {
  limit?: number
  offset?: number
}

export interface SpotifyGetUserPlaylistsResponse extends ToolResponse {
  output: {
    playlists: Array<{
      id: string
      name: string
      description: string | null
      public: boolean
      collaborative: boolean
      owner: string
      total_tracks: number
      image_url: string | null
      external_url: string
    }>
    total: number
    next: string | null
  }
}

/**
 * Create Playlist
 */
export interface SpotifyCreatePlaylistParams extends SpotifyBaseParams {
  name: string
  description?: string
  public?: boolean
  collaborative?: boolean
}

export interface SpotifyCreatePlaylistResponse extends ToolResponse {
  output: {
    id: string
    name: string
    description: string | null
    public: boolean
    collaborative: boolean
    snapshot_id: string
    external_url: string
  }
}

/**
 * Add Tracks to Playlist
 */
export interface SpotifyAddTracksToPlaylistParams extends SpotifyBaseParams {
  playlistId: string
  uris: string
  position?: number
}

export interface SpotifyAddTracksToPlaylistResponse extends ToolResponse {
  output: {
    snapshot_id: string
  }
}

/**
 * Remove Tracks from Playlist
 */
export interface SpotifyRemoveTracksFromPlaylistParams extends SpotifyBaseParams {
  playlistId: string
  uris: string
}

export interface SpotifyRemoveTracksFromPlaylistResponse extends ToolResponse {
  output: {
    snapshot_id: string
  }
}

/**
 * Update Playlist
 */
export interface SpotifyUpdatePlaylistParams extends SpotifyBaseParams {
  playlistId: string
  name?: string
  description?: string
  public?: boolean
  collaborative?: boolean
}

export interface SpotifyUpdatePlaylistResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/**
 * Get Current User
 */
export interface SpotifyGetCurrentUserParams extends SpotifyBaseParams {}

export interface SpotifyGetCurrentUserResponse extends ToolResponse {
  output: {
    id: string
    display_name: string
    email: string | null
    country: string | null
    product: string | null
    followers: number
    image_url: string | null
    external_url: string
  }
}

/**
 * Get User Profile
 */
export interface SpotifyGetUserProfileParams extends SpotifyBaseParams {
  userId: string
}

export interface SpotifyGetUserProfileResponse extends ToolResponse {
  output: {
    id: string
    display_name: string
    followers: number
    image_url: string | null
    external_url: string
  }
}

/**
 * Get Top Items (Tracks or Artists)
 */
export interface SpotifyGetTopItemsParams extends SpotifyBaseParams {
  type: 'tracks' | 'artists'
  time_range?: 'short_term' | 'medium_term' | 'long_term'
  limit?: number
  offset?: number
}

export interface SpotifyGetTopTracksResponse extends ToolResponse {
  output: {
    tracks: Array<{
      id: string
      name: string
      artists: Array<{ id: string; name: string }>
      album: {
        id: string
        name: string
        image_url: string | null
      }
      duration_ms: number
      popularity: number
      external_url: string
    }>
    total: number
    next: string | null
  }
}

export interface SpotifyGetTopArtistsResponse extends ToolResponse {
  output: {
    artists: Array<{
      id: string
      name: string
      genres: string[]
      popularity: number
      followers: number
      image_url: string | null
      external_url: string
    }>
    total: number
    next: string | null
  }
}

/**
 * Get Recently Played
 */
export interface SpotifyGetRecentlyPlayedParams extends SpotifyBaseParams {
  limit?: number
  after?: number
  before?: number
}

export interface SpotifyGetRecentlyPlayedResponse extends ToolResponse {
  output: {
    items: Array<{
      played_at: string
      track: {
        id: string
        name: string
        artists: Array<{ id: string; name: string }>
        album: {
          id: string
          name: string
          image_url: string | null
        }
        duration_ms: number
        external_url: string
      }
    }>
    next: string | null
  }
}

/**
 * Get Saved Tracks
 */
export interface SpotifyGetSavedTracksParams extends SpotifyBaseParams {
  limit?: number
  offset?: number
  market?: string
}

export interface SpotifyGetSavedTracksResponse extends ToolResponse {
  output: {
    tracks: Array<{
      added_at: string
      track: {
        id: string
        name: string
        artists: Array<{ id: string; name: string }>
        album: {
          id: string
          name: string
          image_url: string | null
        }
        duration_ms: number
        popularity: number
        external_url: string
      }
    }>
    total: number
    next: string | null
  }
}

/**
 * Save Tracks
 */
export interface SpotifySaveTracksParams extends SpotifyBaseParams {
  trackIds: string
}

export interface SpotifySaveTracksResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/**
 * Remove Saved Tracks
 */
export interface SpotifyRemoveSavedTracksParams extends SpotifyBaseParams {
  trackIds: string
}

export interface SpotifyRemoveSavedTracksResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/**
 * Check Saved Tracks
 */
export interface SpotifyCheckSavedTracksParams extends SpotifyBaseParams {
  trackIds: string
}

export interface SpotifyCheckSavedTracksResponse extends ToolResponse {
  output: {
    results: Array<{
      id: string
      saved: boolean
    }>
    all_saved: boolean
    none_saved: boolean
  }
}

/**
 * Browse Categories
 */
export interface SpotifyBrowseCategoriesParams extends SpotifyBaseParams {
  country?: string
  locale?: string
  limit?: number
  offset?: number
}

export interface SpotifyBrowseCategoriesResponse extends ToolResponse {
  output: {
    categories: Array<{
      id: string
      name: string
      icon_url: string | null
    }>
    total: number
    next: string | null
  }
}

/**
 * Browse New Releases
 */
export interface SpotifyBrowseNewReleasesParams extends SpotifyBaseParams {
  country?: string
  limit?: number
  offset?: number
}

export interface SpotifyBrowseNewReleasesResponse extends ToolResponse {
  output: {
    albums: Array<{
      id: string
      name: string
      artists: string[]
      album_type: string
      total_tracks: number
      release_date: string
      image_url: string | null
      external_url: string
    }>
    total: number
    next: string | null
  }
}

/**
 * Player - Get Playback State
 */
export interface SpotifyGetPlaybackStateParams extends SpotifyBaseParams {
  market?: string
}

export interface SpotifyGetPlaybackStateResponse extends ToolResponse {
  output: {
    is_playing: boolean
    device: {
      id: string
      name: string
      type: string
      volume_percent: number
    } | null
    progress_ms: number | null
    currently_playing_type: string
    shuffle_state: boolean
    repeat_state: string
    track: {
      id: string
      name: string
      artists: Array<{ id: string; name: string }>
      album: {
        id: string
        name: string
        image_url: string | null
      }
      duration_ms: number
    } | null
  }
}

/**
 * Player - Get Currently Playing
 */
export interface SpotifyGetCurrentlyPlayingParams extends SpotifyBaseParams {
  market?: string
}

export interface SpotifyGetCurrentlyPlayingResponse extends ToolResponse {
  output: {
    is_playing: boolean
    progress_ms: number | null
    track: {
      id: string
      name: string
      artists: Array<{ id: string; name: string }>
      album: {
        id: string
        name: string
        image_url: string | null
      }
      duration_ms: number
      external_url: string
    } | null
  }
}

/**
 * Player - Get Devices
 */
export interface SpotifyGetDevicesParams extends SpotifyBaseParams {}

export interface SpotifyGetDevicesResponse extends ToolResponse {
  output: {
    devices: Array<{
      id: string
      is_active: boolean
      is_private_session: boolean
      is_restricted: boolean
      name: string
      type: string
      volume_percent: number
    }>
  }
}

/**
 * Player - Play
 */
export interface SpotifyPlayParams extends SpotifyBaseParams {
  device_id?: string
  context_uri?: string
  uris?: string
  offset?: number
  position_ms?: number
}

export interface SpotifyPlayResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/**
 * Player - Pause
 */
export interface SpotifyPauseParams extends SpotifyBaseParams {
  device_id?: string
}

export interface SpotifyPauseResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/**
 * Player - Skip Next
 */
export interface SpotifySkipNextParams extends SpotifyBaseParams {
  device_id?: string
}

export interface SpotifySkipNextResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/**
 * Player - Skip Previous
 */
export interface SpotifySkipPreviousParams extends SpotifyBaseParams {
  device_id?: string
}

export interface SpotifySkipPreviousResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/**
 * Player - Seek
 */
export interface SpotifySeekParams extends SpotifyBaseParams {
  position_ms: number
  device_id?: string
}

export interface SpotifySeekResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/**
 * Player - Set Volume
 */
export interface SpotifySetVolumeParams extends SpotifyBaseParams {
  volume_percent: number
  device_id?: string
}

export interface SpotifySetVolumeResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/**
 * Player - Add to Queue
 */
export interface SpotifyAddToQueueParams extends SpotifyBaseParams {
  uri: string
  device_id?: string
}

export interface SpotifyAddToQueueResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/**
 * Player - Transfer Playback
 */
export interface SpotifyTransferPlaybackParams extends SpotifyBaseParams {
  device_id: string
  play?: boolean
}

export interface SpotifyTransferPlaybackResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/**
 * Player - Set Repeat
 */
export interface SpotifySetRepeatParams extends SpotifyBaseParams {
  state: 'track' | 'context' | 'off'
  device_id?: string
}

export interface SpotifySetRepeatResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/**
 * Player - Set Shuffle
 */
export interface SpotifySetShuffleParams extends SpotifyBaseParams {
  state: boolean
  device_id?: string
}

export interface SpotifySetShuffleResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/**
 * Get New Releases
 */
export interface SpotifyGetNewReleasesParams extends SpotifyBaseParams {
  country?: string
  limit?: number
  offset?: number
}

export interface SpotifyGetNewReleasesResponse extends ToolResponse {
  output: {
    albums: Array<{
      id: string
      name: string
      artists: Array<{ id: string; name: string }>
      release_date: string
      total_tracks: number
      album_type: string
      image_url: string | null
      external_url: string
    }>
    total: number
    next: string | null
  }
}

/**
 * Get Categories
 */
export interface SpotifyGetCategoriesParams extends SpotifyBaseParams {
  country?: string
  locale?: string
  limit?: number
}

export interface SpotifyGetCategoriesResponse extends ToolResponse {
  output: {
    categories: Array<{
      id: string
      name: string
      icon_url: string | null
    }>
    total: number
  }
}
