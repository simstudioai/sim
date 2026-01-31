import type { SpotifySearchParams, SpotifySearchResponse } from '@/tools/spotify/types'
import {
  SEARCH_ALBUM_OUTPUT_PROPERTIES,
  SEARCH_ARTIST_OUTPUT_PROPERTIES,
  SEARCH_PLAYLIST_OUTPUT_PROPERTIES,
  SEARCH_TRACK_OUTPUT_PROPERTIES,
} from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifySearchTool: ToolConfig<SpotifySearchParams, SpotifySearchResponse> = {
  id: 'spotify_search',
  name: 'Spotify Search',
  description:
    'Search for tracks, albums, artists, or playlists on Spotify. Returns matching results based on the query.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
  },

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query (e.g., "Bohemian Rhapsody", "artist:Queen", "genre:rock")',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      default: 'track',
      description:
        'Type of results: track, album, artist, playlist, or comma-separated (e.g., "track,artist")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 20,
      description: 'Maximum number of results to return (1-50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 0,
      description: 'Index of the first result to return for pagination',
    },
    market: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 3166-1 alpha-2 country code to filter results (e.g., "US", "GB")',
    },
  },

  request: {
    url: (params) => {
      const type = params.type || 'track'
      const limit = Math.min(Math.max(params.limit || 20, 1), 50)
      const offset = params.offset || 0
      let url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(params.query)}&type=${encodeURIComponent(type)}&limit=${limit}&offset=${offset}`
      if (params.market) {
        url += `&market=${params.market}`
      }
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<SpotifySearchResponse> => {
    const data = await response.json()

    const tracks = (data.tracks?.items || []).map((track: any) => ({
      id: track.id,
      name: track.name,
      artists: track.artists?.map((a: any) => a.name) || [],
      album: track.album?.name || '',
      duration_ms: track.duration_ms,
      popularity: track.popularity,
      preview_url: track.preview_url,
      external_url: track.external_urls?.spotify || '',
    }))

    const artists = (data.artists?.items || []).map((artist: any) => ({
      id: artist.id,
      name: artist.name,
      genres: artist.genres || [],
      popularity: artist.popularity,
      followers: artist.followers?.total || 0,
      image_url: artist.images?.[0]?.url || null,
      external_url: artist.external_urls?.spotify || '',
    }))

    const albums = (data.albums?.items || []).map((album: any) => ({
      id: album.id,
      name: album.name,
      artists: album.artists?.map((a: any) => a.name) || [],
      total_tracks: album.total_tracks,
      release_date: album.release_date,
      image_url: album.images?.[0]?.url || null,
      external_url: album.external_urls?.spotify || '',
    }))

    const playlists = (data.playlists?.items || []).map((playlist: any) => ({
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      owner: playlist.owner?.display_name || '',
      total_tracks: playlist.tracks?.total || 0,
      image_url: playlist.images?.[0]?.url || null,
      external_url: playlist.external_urls?.spotify || '',
    }))

    return {
      success: true,
      output: {
        tracks,
        artists,
        albums,
        playlists,
      },
    }
  },

  outputs: {
    tracks: {
      type: 'array',
      description: 'List of matching tracks',
      items: { type: 'object', properties: SEARCH_TRACK_OUTPUT_PROPERTIES },
    },
    artists: {
      type: 'array',
      description: 'List of matching artists',
      items: { type: 'object', properties: SEARCH_ARTIST_OUTPUT_PROPERTIES },
    },
    albums: {
      type: 'array',
      description: 'List of matching albums',
      items: { type: 'object', properties: SEARCH_ALBUM_OUTPUT_PROPERTIES },
    },
    playlists: {
      type: 'array',
      description: 'List of matching playlists',
      items: { type: 'object', properties: SEARCH_PLAYLIST_OUTPUT_PROPERTIES },
    },
  },
}
