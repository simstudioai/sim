import { SpotifyIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { ToolResponse } from '@/tools/types'

export const SpotifyBlock: BlockConfig<ToolResponse> = {
  type: 'spotify',
  name: 'Spotify',
  description: 'Search music, manage playlists, control playback, and access your library',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Spotify into your workflow. Search for tracks, albums, artists, and playlists. Manage playlists, access your library, control playback, browse podcasts and audiobooks.',
  docsLink: 'https://docs.sim.ai/tools/spotify',
  category: 'tools',
  hideFromToolbar: true,
  bgColor: '#000000',
  icon: SpotifyIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Search & Discovery
        { label: 'Search', id: 'spotify_search', group: 'Search & Discovery' },
        // Tracks
        { label: 'Get Track', id: 'spotify_get_track', group: 'Tracks' },
        { label: 'Get Multiple Tracks', id: 'spotify_get_tracks', group: 'Tracks' },
        // Albums
        { label: 'Get Album', id: 'spotify_get_album', group: 'Albums' },
        { label: 'Get Multiple Albums', id: 'spotify_get_albums', group: 'Albums' },
        { label: 'Get Album Tracks', id: 'spotify_get_album_tracks', group: 'Albums' },
        { label: 'Get Saved Albums', id: 'spotify_get_saved_albums', group: 'Albums' },
        { label: 'Save Albums', id: 'spotify_save_albums', group: 'Albums' },
        { label: 'Remove Saved Albums', id: 'spotify_remove_saved_albums', group: 'Albums' },
        { label: 'Check Saved Albums', id: 'spotify_check_saved_albums', group: 'Albums' },
        // Artists
        { label: 'Get Artist', id: 'spotify_get_artist', group: 'Artists' },
        { label: 'Get Multiple Artists', id: 'spotify_get_artists', group: 'Artists' },
        { label: 'Get Artist Albums', id: 'spotify_get_artist_albums', group: 'Artists' },
        { label: 'Get Artist Top Tracks', id: 'spotify_get_artist_top_tracks', group: 'Artists' },
        { label: 'Follow Artists', id: 'spotify_follow_artists', group: 'Artists' },
        { label: 'Unfollow Artists', id: 'spotify_unfollow_artists', group: 'Artists' },
        { label: 'Get Followed Artists', id: 'spotify_get_followed_artists', group: 'Artists' },
        { label: 'Check Following', id: 'spotify_check_following', group: 'Artists' },
        // Shows (Podcasts)
        { label: 'Get Show', id: 'spotify_get_show', group: 'Podcasts' },
        { label: 'Get Multiple Shows', id: 'spotify_get_shows', group: 'Podcasts' },
        { label: 'Get Show Episodes', id: 'spotify_get_show_episodes', group: 'Podcasts' },
        { label: 'Get Saved Shows', id: 'spotify_get_saved_shows', group: 'Podcasts' },
        { label: 'Save Shows', id: 'spotify_save_shows', group: 'Podcasts' },
        { label: 'Remove Saved Shows', id: 'spotify_remove_saved_shows', group: 'Podcasts' },
        { label: 'Check Saved Shows', id: 'spotify_check_saved_shows', group: 'Podcasts' },
        // Episodes
        { label: 'Get Episode', id: 'spotify_get_episode', group: 'Episodes' },
        { label: 'Get Multiple Episodes', id: 'spotify_get_episodes', group: 'Episodes' },
        { label: 'Get Saved Episodes', id: 'spotify_get_saved_episodes', group: 'Episodes' },
        { label: 'Save Episodes', id: 'spotify_save_episodes', group: 'Episodes' },
        { label: 'Remove Saved Episodes', id: 'spotify_remove_saved_episodes', group: 'Episodes' },
        { label: 'Check Saved Episodes', id: 'spotify_check_saved_episodes', group: 'Episodes' },
        // Audiobooks
        { label: 'Get Audiobook', id: 'spotify_get_audiobook', group: 'Audiobooks' },
        { label: 'Get Multiple Audiobooks', id: 'spotify_get_audiobooks', group: 'Audiobooks' },
        {
          label: 'Get Audiobook Chapters',
          id: 'spotify_get_audiobook_chapters',
          group: 'Audiobooks',
        },
        { label: 'Get Saved Audiobooks', id: 'spotify_get_saved_audiobooks', group: 'Audiobooks' },
        { label: 'Save Audiobooks', id: 'spotify_save_audiobooks', group: 'Audiobooks' },
        {
          label: 'Remove Saved Audiobooks',
          id: 'spotify_remove_saved_audiobooks',
          group: 'Audiobooks',
        },
        {
          label: 'Check Saved Audiobooks',
          id: 'spotify_check_saved_audiobooks',
          group: 'Audiobooks',
        },
        // Playlists
        { label: 'Get Playlist', id: 'spotify_get_playlist', group: 'Playlists' },
        { label: 'Get Playlist Tracks', id: 'spotify_get_playlist_tracks', group: 'Playlists' },
        { label: 'Get Playlist Cover', id: 'spotify_get_playlist_cover', group: 'Playlists' },
        { label: 'Get My Playlists', id: 'spotify_get_user_playlists', group: 'Playlists' },
        { label: 'Create Playlist', id: 'spotify_create_playlist', group: 'Playlists' },
        { label: 'Update Playlist', id: 'spotify_update_playlist', group: 'Playlists' },
        { label: 'Add Playlist Cover', id: 'spotify_add_playlist_cover', group: 'Playlists' },
        {
          label: 'Add Tracks to Playlist',
          id: 'spotify_add_tracks_to_playlist',
          group: 'Playlists',
        },
        {
          label: 'Remove Tracks from Playlist',
          id: 'spotify_remove_tracks_from_playlist',
          group: 'Playlists',
        },
        {
          label: 'Reorder Playlist Items',
          id: 'spotify_reorder_playlist_items',
          group: 'Playlists',
        },
        {
          label: 'Replace Playlist Items',
          id: 'spotify_replace_playlist_items',
          group: 'Playlists',
        },
        { label: 'Follow Playlist', id: 'spotify_follow_playlist', group: 'Playlists' },
        { label: 'Unfollow Playlist', id: 'spotify_unfollow_playlist', group: 'Playlists' },
        {
          label: 'Check Playlist Followers',
          id: 'spotify_check_playlist_followers',
          group: 'Playlists',
        },
        // User Profile & Library
        { label: 'Get My Profile', id: 'spotify_get_current_user', group: 'User & Library' },
        { label: 'Get User Profile', id: 'spotify_get_user_profile', group: 'User & Library' },
        { label: 'Get My Top Tracks', id: 'spotify_get_top_tracks', group: 'User & Library' },
        { label: 'Get My Top Artists', id: 'spotify_get_top_artists', group: 'User & Library' },
        { label: 'Get Saved Tracks', id: 'spotify_get_saved_tracks', group: 'User & Library' },
        { label: 'Save Tracks', id: 'spotify_save_tracks', group: 'User & Library' },
        {
          label: 'Remove Saved Tracks',
          id: 'spotify_remove_saved_tracks',
          group: 'User & Library',
        },
        { label: 'Check Saved Tracks', id: 'spotify_check_saved_tracks', group: 'User & Library' },
        {
          label: 'Get Recently Played',
          id: 'spotify_get_recently_played',
          group: 'User & Library',
        },
        // Browse
        { label: 'Get New Releases', id: 'spotify_get_new_releases', group: 'Browse' },
        { label: 'Get Categories', id: 'spotify_get_categories', group: 'Browse' },
        { label: 'Get Available Markets', id: 'spotify_get_markets', group: 'Browse' },
        // Player Controls
        { label: 'Get Playback State', id: 'spotify_get_playback_state', group: 'Player' },
        { label: 'Get Currently Playing', id: 'spotify_get_currently_playing', group: 'Player' },
        { label: 'Get Devices', id: 'spotify_get_devices', group: 'Player' },
        { label: 'Get Queue', id: 'spotify_get_queue', group: 'Player' },
        { label: 'Play', id: 'spotify_play', group: 'Player' },
        { label: 'Pause', id: 'spotify_pause', group: 'Player' },
        { label: 'Skip to Next', id: 'spotify_skip_next', group: 'Player' },
        { label: 'Skip to Previous', id: 'spotify_skip_previous', group: 'Player' },
        { label: 'Seek', id: 'spotify_seek', group: 'Player' },
        { label: 'Add to Queue', id: 'spotify_add_to_queue', group: 'Player' },
        { label: 'Set Volume', id: 'spotify_set_volume', group: 'Player' },
        { label: 'Set Repeat', id: 'spotify_set_repeat', group: 'Player' },
        { label: 'Set Shuffle', id: 'spotify_set_shuffle', group: 'Player' },
        { label: 'Transfer Playback', id: 'spotify_transfer_playback', group: 'Player' },
      ],
      value: () => 'spotify_search',
    },

    {
      id: 'credential',
      title: 'Spotify Account',
      type: 'oauth-input',
      serviceId: 'spotify',
      required: true,
    },

    // === SEARCH ===
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'e.g., "Bohemian Rhapsody", "artist:Queen"',
      required: true,
      condition: { field: 'operation', value: 'spotify_search' },
    },
    {
      id: 'type',
      title: 'Search Type',
      type: 'dropdown',
      options: [
        { label: 'Tracks', id: 'track' },
        { label: 'Albums', id: 'album' },
        { label: 'Artists', id: 'artist' },
        { label: 'Playlists', id: 'playlist' },
        { label: 'Shows', id: 'show' },
        { label: 'Episodes', id: 'episode' },
        { label: 'Audiobooks', id: 'audiobook' },
        { label: 'All', id: 'track,album,artist,playlist' },
      ],
      value: () => 'track',
      condition: { field: 'operation', value: 'spotify_search' },
    },

    // === TRACK IDs ===
    {
      id: 'trackId',
      title: 'Track ID',
      type: 'short-input',
      placeholder: 'Spotify track ID',
      required: true,
      condition: { field: 'operation', value: 'spotify_get_track' },
    },
    {
      id: 'trackIds',
      title: 'Track IDs',
      type: 'short-input',
      placeholder: 'Comma-separated track IDs',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'spotify_get_tracks',
          'spotify_save_tracks',
          'spotify_remove_saved_tracks',
          'spotify_check_saved_tracks',
        ],
      },
    },

    // === ALBUM ID ===
    {
      id: 'albumId',
      title: 'Album ID',
      type: 'short-input',
      placeholder: 'Spotify album ID',
      required: true,
      condition: { field: 'operation', value: ['spotify_get_album', 'spotify_get_album_tracks'] },
    },
    {
      id: 'albumIds',
      title: 'Album IDs',
      type: 'short-input',
      placeholder: 'Comma-separated album IDs',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'spotify_get_albums',
          'spotify_save_albums',
          'spotify_remove_saved_albums',
          'spotify_check_saved_albums',
        ],
      },
    },

    // === ARTIST ID ===
    {
      id: 'artistId',
      title: 'Artist ID',
      type: 'short-input',
      placeholder: 'Spotify artist ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['spotify_get_artist', 'spotify_get_artist_albums', 'spotify_get_artist_top_tracks'],
      },
    },
    {
      id: 'artistIds',
      title: 'Artist IDs',
      type: 'short-input',
      placeholder: 'Comma-separated artist IDs',
      required: true,
      condition: {
        field: 'operation',
        value: ['spotify_get_artists', 'spotify_follow_artists', 'spotify_unfollow_artists'],
      },
    },

    // === SHOW IDs ===
    {
      id: 'showId',
      title: 'Show ID',
      type: 'short-input',
      placeholder: 'Spotify show/podcast ID',
      required: true,
      condition: { field: 'operation', value: ['spotify_get_show', 'spotify_get_show_episodes'] },
    },
    {
      id: 'showIds',
      title: 'Show IDs',
      type: 'short-input',
      placeholder: 'Comma-separated show IDs',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'spotify_get_shows',
          'spotify_save_shows',
          'spotify_remove_saved_shows',
          'spotify_check_saved_shows',
        ],
      },
    },

    // === EPISODE IDs ===
    {
      id: 'episodeId',
      title: 'Episode ID',
      type: 'short-input',
      placeholder: 'Spotify episode ID',
      required: true,
      condition: { field: 'operation', value: 'spotify_get_episode' },
    },
    {
      id: 'episodeIds',
      title: 'Episode IDs',
      type: 'short-input',
      placeholder: 'Comma-separated episode IDs',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'spotify_get_episodes',
          'spotify_save_episodes',
          'spotify_remove_saved_episodes',
          'spotify_check_saved_episodes',
        ],
      },
    },

    // === AUDIOBOOK IDs ===
    {
      id: 'audiobookId',
      title: 'Audiobook ID',
      type: 'short-input',
      placeholder: 'Spotify audiobook ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['spotify_get_audiobook', 'spotify_get_audiobook_chapters'],
      },
    },
    {
      id: 'audiobookIds',
      title: 'Audiobook IDs',
      type: 'short-input',
      placeholder: 'Comma-separated audiobook IDs',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'spotify_get_audiobooks',
          'spotify_save_audiobooks',
          'spotify_remove_saved_audiobooks',
          'spotify_check_saved_audiobooks',
        ],
      },
    },

    // === CHECK FOLLOWING ===
    {
      id: 'followType',
      title: 'Type',
      type: 'dropdown',
      options: [
        { label: 'Artist', id: 'artist' },
        { label: 'User', id: 'user' },
      ],
      value: () => 'artist',
      condition: { field: 'operation', value: 'spotify_check_following' },
    },
    {
      id: 'ids',
      title: 'IDs to Check',
      type: 'short-input',
      placeholder: 'Comma-separated artist or user IDs',
      required: true,
      condition: { field: 'operation', value: 'spotify_check_following' },
    },

    // === USER ID ===
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Spotify user ID',
      required: true,
      condition: { field: 'operation', value: 'spotify_get_user_profile' },
    },

    // === PLAYLIST OPERATIONS ===
    {
      id: 'playlistId',
      title: 'Playlist ID',
      type: 'short-input',
      placeholder: 'Spotify playlist ID',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'spotify_get_playlist',
          'spotify_get_playlist_tracks',
          'spotify_get_playlist_cover',
          'spotify_update_playlist',
          'spotify_add_playlist_cover',
          'spotify_add_tracks_to_playlist',
          'spotify_remove_tracks_from_playlist',
          'spotify_reorder_playlist_items',
          'spotify_replace_playlist_items',
          'spotify_follow_playlist',
          'spotify_unfollow_playlist',
          'spotify_check_playlist_followers',
        ],
      },
    },
    {
      id: 'name',
      title: 'Playlist Name',
      type: 'short-input',
      placeholder: 'My Awesome Playlist',
      required: true,
      condition: { field: 'operation', value: 'spotify_create_playlist' },
    },
    {
      id: 'newName',
      title: 'New Name',
      type: 'short-input',
      placeholder: 'New playlist name (optional)',
      condition: { field: 'operation', value: 'spotify_update_playlist' },
    },
    {
      id: 'description',
      title: 'Playlist Description',
      type: 'long-input',
      placeholder: 'Optional description for the playlist',
      condition: {
        field: 'operation',
        value: ['spotify_create_playlist', 'spotify_update_playlist'],
      },
    },
    {
      id: 'public',
      title: 'Public',
      type: 'switch',
      defaultValue: true,
      condition: {
        field: 'operation',
        value: ['spotify_create_playlist', 'spotify_update_playlist', 'spotify_follow_playlist'],
      },
    },

    // === CHECK PLAYLIST FOLLOWERS ===
    {
      id: 'userIds',
      title: 'User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs to check (max 5)',
      required: true,
      condition: { field: 'operation', value: 'spotify_check_playlist_followers' },
    },

    // === PLAYLIST COVER ===
    {
      id: 'coverImageFile',
      title: 'Cover Image',
      type: 'file-upload',
      canonicalParamId: 'coverImage',
      placeholder: 'Upload cover image (JPEG, max 256KB)',
      mode: 'basic',
      multiple: false,
      required: true,
      acceptedTypes: '.jpg,.jpeg',
      condition: { field: 'operation', value: 'spotify_add_playlist_cover' },
    },
    {
      id: 'coverImageRef',
      title: 'Cover Image',
      type: 'short-input',
      canonicalParamId: 'coverImage',
      placeholder: 'Reference image from previous blocks',
      mode: 'advanced',
      required: true,
      condition: { field: 'operation', value: 'spotify_add_playlist_cover' },
    },

    // === REORDER PLAYLIST ===
    {
      id: 'range_start',
      title: 'Range Start',
      type: 'short-input',
      placeholder: 'Start index of items to move',
      required: true,
      condition: { field: 'operation', value: 'spotify_reorder_playlist_items' },
    },
    {
      id: 'insert_before',
      title: 'Insert Before',
      type: 'short-input',
      placeholder: 'Index to insert before',
      required: true,
      condition: { field: 'operation', value: 'spotify_reorder_playlist_items' },
    },
    {
      id: 'range_length',
      title: 'Range Length',
      type: 'short-input',
      placeholder: 'Number of items to move (default: 1)',
      condition: { field: 'operation', value: 'spotify_reorder_playlist_items' },
    },

    // === ADD/REMOVE/REPLACE TRACKS FROM PLAYLIST ===
    {
      id: 'uris',
      title: 'Track URIs',
      type: 'short-input',
      placeholder: 'spotify:track:xxx,spotify:track:yyy',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'spotify_add_tracks_to_playlist',
          'spotify_remove_tracks_from_playlist',
          'spotify_replace_playlist_items',
        ],
      },
    },

    // === COUNTRY/LOCALE ===
    {
      id: 'country',
      title: 'Country',
      type: 'short-input',
      placeholder: 'ISO country code (e.g., US, GB)',
      condition: {
        field: 'operation',
        value: ['spotify_get_new_releases', 'spotify_get_categories'],
      },
    },

    // === TOP ITEMS TIME RANGE ===
    {
      id: 'time_range',
      title: 'Time Range',
      type: 'dropdown',
      options: [
        { label: 'Last 4 Weeks', id: 'short_term' },
        { label: 'Last 6 Months', id: 'medium_term' },
        { label: 'All Time', id: 'long_term' },
      ],
      value: () => 'medium_term',
      condition: {
        field: 'operation',
        value: ['spotify_get_top_tracks', 'spotify_get_top_artists'],
      },
    },

    // === PLAYER CONTROLS ===
    {
      id: 'device_id',
      title: 'Device ID',
      type: 'short-input',
      placeholder: 'Optional - uses active device if not specified',
      condition: {
        field: 'operation',
        value: [
          'spotify_play',
          'spotify_pause',
          'spotify_skip_next',
          'spotify_skip_previous',
          'spotify_add_to_queue',
          'spotify_set_volume',
          'spotify_seek',
          'spotify_set_repeat',
          'spotify_set_shuffle',
        ],
      },
    },
    {
      id: 'context_uri',
      title: 'Context URI',
      type: 'short-input',
      placeholder: 'spotify:album:xxx or spotify:playlist:yyy',
      condition: { field: 'operation', value: 'spotify_play' },
    },
    {
      id: 'playUris',
      title: 'Track URIs',
      type: 'short-input',
      placeholder: 'spotify:track:xxx (comma-separated for multiple)',
      condition: { field: 'operation', value: 'spotify_play' },
    },
    {
      id: 'uri',
      title: 'Track URI',
      type: 'short-input',
      placeholder: 'spotify:track:xxx',
      required: true,
      condition: { field: 'operation', value: 'spotify_add_to_queue' },
    },
    {
      id: 'volume_percent',
      title: 'Volume',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      integer: true,
      condition: { field: 'operation', value: 'spotify_set_volume' },
    },

    // === SEEK ===
    {
      id: 'position_ms',
      title: 'Position (ms)',
      type: 'short-input',
      placeholder: 'Position in milliseconds',
      required: true,
      condition: { field: 'operation', value: 'spotify_seek' },
    },

    // === REPEAT ===
    {
      id: 'state',
      title: 'Repeat Mode',
      type: 'dropdown',
      options: [
        { label: 'Off', id: 'off' },
        { label: 'Track', id: 'track' },
        { label: 'Context (Album/Playlist)', id: 'context' },
      ],
      value: () => 'off',
      condition: { field: 'operation', value: 'spotify_set_repeat' },
    },

    // === SHUFFLE ===
    {
      id: 'shuffle_state',
      title: 'Shuffle',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: 'spotify_set_shuffle' },
    },

    // === TRANSFER PLAYBACK ===
    {
      id: 'target_device_id',
      title: 'Target Device ID',
      type: 'short-input',
      placeholder: 'Device ID to transfer to',
      required: true,
      condition: { field: 'operation', value: 'spotify_transfer_playback' },
    },

    // === COMMON: LIMIT ===
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of results (1-50, default: 20)',
      condition: {
        field: 'operation',
        value: [
          'spotify_search',
          'spotify_get_album_tracks',
          'spotify_get_saved_albums',
          'spotify_get_artist_albums',
          'spotify_get_playlist_tracks',
          'spotify_get_user_playlists',
          'spotify_get_top_tracks',
          'spotify_get_top_artists',
          'spotify_get_saved_tracks',
          'spotify_get_recently_played',
          'spotify_get_new_releases',
          'spotify_get_categories',
          'spotify_get_followed_artists',
          'spotify_get_show_episodes',
          'spotify_get_saved_shows',
          'spotify_get_saved_episodes',
          'spotify_get_audiobook_chapters',
          'spotify_get_saved_audiobooks',
        ],
      },
    },
  ],
  tools: {
    access: [
      'spotify_search',
      'spotify_get_track',
      'spotify_get_tracks',
      'spotify_get_album',
      'spotify_get_albums',
      'spotify_get_album_tracks',
      'spotify_get_saved_albums',
      'spotify_save_albums',
      'spotify_remove_saved_albums',
      'spotify_check_saved_albums',
      'spotify_get_artist',
      'spotify_get_artists',
      'spotify_get_artist_albums',
      'spotify_get_artist_top_tracks',
      'spotify_follow_artists',
      'spotify_unfollow_artists',
      'spotify_get_followed_artists',
      'spotify_check_following',
      'spotify_get_show',
      'spotify_get_shows',
      'spotify_get_show_episodes',
      'spotify_get_saved_shows',
      'spotify_save_shows',
      'spotify_remove_saved_shows',
      'spotify_check_saved_shows',
      'spotify_get_episode',
      'spotify_get_episodes',
      'spotify_get_saved_episodes',
      'spotify_save_episodes',
      'spotify_remove_saved_episodes',
      'spotify_check_saved_episodes',
      'spotify_get_audiobook',
      'spotify_get_audiobooks',
      'spotify_get_audiobook_chapters',
      'spotify_get_saved_audiobooks',
      'spotify_save_audiobooks',
      'spotify_remove_saved_audiobooks',
      'spotify_check_saved_audiobooks',
      'spotify_get_playlist',
      'spotify_get_playlist_tracks',
      'spotify_get_playlist_cover',
      'spotify_get_user_playlists',
      'spotify_create_playlist',
      'spotify_update_playlist',
      'spotify_add_playlist_cover',
      'spotify_add_tracks_to_playlist',
      'spotify_remove_tracks_from_playlist',
      'spotify_reorder_playlist_items',
      'spotify_replace_playlist_items',
      'spotify_follow_playlist',
      'spotify_unfollow_playlist',
      'spotify_check_playlist_followers',
      'spotify_get_current_user',
      'spotify_get_user_profile',
      'spotify_get_top_tracks',
      'spotify_get_top_artists',
      'spotify_get_saved_tracks',
      'spotify_save_tracks',
      'spotify_remove_saved_tracks',
      'spotify_check_saved_tracks',
      'spotify_get_recently_played',
      'spotify_get_new_releases',
      'spotify_get_categories',
      'spotify_get_markets',
      'spotify_get_playback_state',
      'spotify_get_currently_playing',
      'spotify_get_devices',
      'spotify_get_queue',
      'spotify_play',
      'spotify_pause',
      'spotify_skip_next',
      'spotify_skip_previous',
      'spotify_seek',
      'spotify_add_to_queue',
      'spotify_set_volume',
      'spotify_set_repeat',
      'spotify_set_shuffle',
      'spotify_transfer_playback',
    ],
    config: {
      tool: (params) => {
        // Convert numeric parameters
        if (params.limit) {
          params.limit = Number(params.limit)
        }
        if (params.volume_percent) {
          params.volume_percent = Number(params.volume_percent)
        }
        if (params.range_start) {
          params.range_start = Number(params.range_start)
        }
        if (params.insert_before) {
          params.insert_before = Number(params.insert_before)
        }
        if (params.range_length) {
          params.range_length = Number(params.range_length)
        }
        if (params.position_ms) {
          params.position_ms = Number(params.position_ms)
        }
        // Map followType to type for check_following
        if (params.followType) {
          params.type = params.followType
        }
        // Map newName to name for update_playlist
        if (params.newName) {
          params.name = params.newName
        }
        // Map playUris to uris for play
        if (params.playUris) {
          params.uris = params.playUris
        }
        // Normalize file input for cover image
        if (params.coverImage !== undefined) {
          params.coverImage = normalizeFileInput(params.coverImage, { single: true })
        }
        return params.operation || 'spotify_search'
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Spotify OAuth credential' },
    // Search
    query: { type: 'string', description: 'Search query' },
    type: { type: 'string', description: 'Search type' },
    // IDs
    trackId: { type: 'string', description: 'Spotify track ID' },
    trackIds: { type: 'string', description: 'Comma-separated track IDs' },
    albumId: { type: 'string', description: 'Spotify album ID' },
    albumIds: { type: 'string', description: 'Comma-separated album IDs' },
    artistId: { type: 'string', description: 'Spotify artist ID' },
    artistIds: { type: 'string', description: 'Comma-separated artist IDs' },
    showId: { type: 'string', description: 'Spotify show ID' },
    showIds: { type: 'string', description: 'Comma-separated show IDs' },
    episodeId: { type: 'string', description: 'Spotify episode ID' },
    episodeIds: { type: 'string', description: 'Comma-separated episode IDs' },
    audiobookId: { type: 'string', description: 'Spotify audiobook ID' },
    audiobookIds: { type: 'string', description: 'Comma-separated audiobook IDs' },
    playlistId: { type: 'string', description: 'Spotify playlist ID' },
    userId: { type: 'string', description: 'Spotify user ID' },
    userIds: { type: 'string', description: 'Comma-separated user IDs' },
    ids: { type: 'string', description: 'Comma-separated IDs' },
    followType: { type: 'string', description: 'Type to check (artist or user)' },
    // Playlist
    name: { type: 'string', description: 'Playlist name' },
    newName: { type: 'string', description: 'New playlist name' },
    description: { type: 'string', description: 'Playlist description' },
    public: { type: 'boolean', description: 'Whether playlist is public' },
    coverImage: { type: 'json', description: 'Cover image (UserFile)' },
    range_start: { type: 'number', description: 'Start index for reorder' },
    insert_before: { type: 'number', description: 'Insert before index' },
    range_length: { type: 'number', description: 'Number of items to move' },
    // Track URIs
    uris: { type: 'string', description: 'Comma-separated Spotify URIs' },
    playUris: { type: 'string', description: 'Track URIs to play' },
    uri: { type: 'string', description: 'Spotify URI' },
    // Time range
    time_range: { type: 'string', description: 'Time range for top items' },
    // Browse
    country: { type: 'string', description: 'ISO country code' },
    // Player
    device_id: { type: 'string', description: 'Device ID for playback' },
    context_uri: { type: 'string', description: 'Context URI (album, playlist, artist)' },
    volume_percent: { type: 'number', description: 'Volume level (0-100)' },
    position_ms: { type: 'number', description: 'Position in milliseconds' },
    state: { type: 'string', description: 'Repeat mode (off, track, context)' },
    shuffle_state: { type: 'boolean', description: 'Shuffle on/off' },
    target_device_id: { type: 'string', description: 'Target device ID for transfer' },
    // Common
    limit: { type: 'number', description: 'Maximum number of results' },
  },
  outputs: {
    // === SEARCH OUTPUTS ===
    tracks: {
      type: 'json',
      description: 'List of tracks',
      condition: {
        field: 'operation',
        value: [
          'spotify_search',
          'spotify_get_tracks',
          'spotify_get_album_tracks',
          'spotify_get_playlist_tracks',
          'spotify_get_artist_top_tracks',
          'spotify_get_saved_tracks',
          'spotify_get_top_tracks',
        ],
      },
    },
    artists: {
      type: 'json',
      description: 'List of artists',
      condition: {
        field: 'operation',
        value: [
          'spotify_search',
          'spotify_get_artists',
          'spotify_get_top_artists',
          'spotify_get_followed_artists',
        ],
      },
    },
    albums: {
      type: 'json',
      description: 'List of albums',
      condition: {
        field: 'operation',
        value: [
          'spotify_search',
          'spotify_get_albums',
          'spotify_get_artist_albums',
          'spotify_get_saved_albums',
          'spotify_get_new_releases',
        ],
      },
    },
    playlists: {
      type: 'json',
      description: 'List of playlists',
      condition: { field: 'operation', value: ['spotify_search', 'spotify_get_user_playlists'] },
    },

    // === SINGLE ITEM OUTPUTS ===
    id: {
      type: 'string',
      description: 'Spotify ID',
      condition: {
        field: 'operation',
        value: [
          'spotify_get_track',
          'spotify_get_album',
          'spotify_get_artist',
          'spotify_get_playlist',
          'spotify_get_show',
          'spotify_get_episode',
          'spotify_get_audiobook',
          'spotify_get_current_user',
          'spotify_get_user_profile',
          'spotify_create_playlist',
        ],
      },
    },
    name: {
      type: 'string',
      description: 'Name',
      condition: {
        field: 'operation',
        value: [
          'spotify_get_track',
          'spotify_get_album',
          'spotify_get_artist',
          'spotify_get_playlist',
          'spotify_get_show',
          'spotify_get_episode',
          'spotify_get_audiobook',
          'spotify_create_playlist',
        ],
      },
    },
    uri: {
      type: 'string',
      description: 'Spotify URI',
      condition: { field: 'operation', value: 'spotify_get_track' },
    },
    external_url: {
      type: 'string',
      description: 'Spotify URL',
      condition: {
        field: 'operation',
        value: [
          'spotify_get_track',
          'spotify_get_album',
          'spotify_get_artist',
          'spotify_get_playlist',
          'spotify_get_show',
          'spotify_get_episode',
          'spotify_get_audiobook',
          'spotify_get_current_user',
          'spotify_get_user_profile',
          'spotify_create_playlist',
        ],
      },
    },
    image_url: {
      type: 'string',
      description: 'Cover/profile image URL',
      condition: {
        field: 'operation',
        value: [
          'spotify_get_track',
          'spotify_get_album',
          'spotify_get_artist',
          'spotify_get_playlist',
          'spotify_get_show',
          'spotify_get_episode',
          'spotify_get_audiobook',
          'spotify_get_current_user',
          'spotify_get_user_profile',
          'spotify_get_playlist_cover',
        ],
      },
    },
    popularity: {
      type: 'number',
      description: 'Popularity score (0-100)',
      condition: {
        field: 'operation',
        value: ['spotify_get_track', 'spotify_get_album', 'spotify_get_artist'],
      },
    },

    // === TRACK OUTPUTS ===
    album: {
      type: 'json',
      description: 'Album information',
      condition: { field: 'operation', value: 'spotify_get_track' },
    },
    duration_ms: {
      type: 'number',
      description: 'Duration in milliseconds',
      condition: { field: 'operation', value: ['spotify_get_track', 'spotify_get_episode'] },
    },
    explicit: {
      type: 'boolean',
      description: 'Contains explicit content',
      condition: {
        field: 'operation',
        value: ['spotify_get_track', 'spotify_get_show', 'spotify_get_episode'],
      },
    },
    preview_url: {
      type: 'string',
      description: 'URL to 30-second preview',
      condition: { field: 'operation', value: 'spotify_get_track' },
    },

    // === ALBUM OUTPUTS ===
    album_type: {
      type: 'string',
      description: 'Album type (album, single, compilation)',
      condition: { field: 'operation', value: 'spotify_get_album' },
    },
    release_date: {
      type: 'string',
      description: 'Release date',
      condition: { field: 'operation', value: ['spotify_get_album', 'spotify_get_episode'] },
    },
    label: {
      type: 'string',
      description: 'Record label',
      condition: { field: 'operation', value: 'spotify_get_album' },
    },
    total_tracks: {
      type: 'number',
      description: 'Total tracks',
      condition: { field: 'operation', value: ['spotify_get_album', 'spotify_get_playlist'] },
    },
    genres: {
      type: 'json',
      description: 'List of genres',
      condition: { field: 'operation', value: ['spotify_get_album', 'spotify_get_artist'] },
    },

    // === ARTIST OUTPUTS ===
    followers: {
      type: 'number',
      description: 'Number of followers',
      condition: {
        field: 'operation',
        value: ['spotify_get_artist', 'spotify_get_current_user', 'spotify_get_user_profile'],
      },
    },

    // === PLAYLIST OUTPUTS ===
    description: {
      type: 'string',
      description: 'Description',
      condition: {
        field: 'operation',
        value: [
          'spotify_get_playlist',
          'spotify_get_show',
          'spotify_get_episode',
          'spotify_get_audiobook',
          'spotify_create_playlist',
        ],
      },
    },
    owner: {
      type: 'json',
      description: 'Playlist owner information',
      condition: { field: 'operation', value: ['spotify_get_playlist', 'spotify_create_playlist'] },
    },
    public: {
      type: 'boolean',
      description: 'Whether playlist is public',
      condition: { field: 'operation', value: ['spotify_get_playlist', 'spotify_create_playlist'] },
    },
    collaborative: {
      type: 'boolean',
      description: 'Whether playlist is collaborative',
      condition: { field: 'operation', value: ['spotify_get_playlist', 'spotify_create_playlist'] },
    },
    snapshot_id: {
      type: 'string',
      description: 'Playlist version snapshot ID',
      condition: {
        field: 'operation',
        value: [
          'spotify_get_playlist',
          'spotify_create_playlist',
          'spotify_add_tracks_to_playlist',
          'spotify_remove_tracks_from_playlist',
          'spotify_reorder_playlist_items',
          'spotify_replace_playlist_items',
        ],
      },
    },

    // === SHOW/PODCAST OUTPUTS ===
    publisher: {
      type: 'string',
      description: 'Publisher name',
      condition: { field: 'operation', value: ['spotify_get_show', 'spotify_get_audiobook'] },
    },
    total_episodes: {
      type: 'number',
      description: 'Total episodes in show',
      condition: { field: 'operation', value: 'spotify_get_show' },
    },
    shows: {
      type: 'json',
      description: 'List of shows/podcasts',
      condition: { field: 'operation', value: ['spotify_get_shows', 'spotify_get_saved_shows'] },
    },
    languages: {
      type: 'json',
      description: 'List of languages',
      condition: { field: 'operation', value: ['spotify_get_show', 'spotify_get_audiobook'] },
    },

    // === EPISODE OUTPUTS ===
    show: {
      type: 'json',
      description: 'Parent show information',
      condition: { field: 'operation', value: 'spotify_get_episode' },
    },
    episodes: {
      type: 'json',
      description: 'List of episodes',
      condition: {
        field: 'operation',
        value: ['spotify_get_episodes', 'spotify_get_show_episodes', 'spotify_get_saved_episodes'],
      },
    },

    // === AUDIOBOOK OUTPUTS ===
    authors: {
      type: 'json',
      description: 'List of authors',
      condition: { field: 'operation', value: 'spotify_get_audiobook' },
    },
    narrators: {
      type: 'json',
      description: 'List of narrators',
      condition: { field: 'operation', value: 'spotify_get_audiobook' },
    },
    total_chapters: {
      type: 'number',
      description: 'Total chapters',
      condition: { field: 'operation', value: 'spotify_get_audiobook' },
    },
    audiobooks: {
      type: 'json',
      description: 'List of audiobooks',
      condition: {
        field: 'operation',
        value: ['spotify_get_audiobooks', 'spotify_get_saved_audiobooks'],
      },
    },
    chapters: {
      type: 'json',
      description: 'List of chapters',
      condition: { field: 'operation', value: 'spotify_get_audiobook_chapters' },
    },

    // === USER PROFILE OUTPUTS ===
    display_name: {
      type: 'string',
      description: 'User display name',
      condition: {
        field: 'operation',
        value: ['spotify_get_current_user', 'spotify_get_user_profile'],
      },
    },
    email: {
      type: 'string',
      description: 'User email address',
      condition: { field: 'operation', value: 'spotify_get_current_user' },
    },
    country: {
      type: 'string',
      description: 'User country code',
      condition: { field: 'operation', value: 'spotify_get_current_user' },
    },
    product: {
      type: 'string',
      description: 'Subscription level (free, premium)',
      condition: { field: 'operation', value: 'spotify_get_current_user' },
    },

    // === PLAYER STATE OUTPUTS ===
    is_playing: {
      type: 'boolean',
      description: 'Whether playback is active',
      condition: {
        field: 'operation',
        value: ['spotify_get_playback_state', 'spotify_get_currently_playing'],
      },
    },
    device: {
      type: 'json',
      description: 'Active device information',
      condition: { field: 'operation', value: 'spotify_get_playback_state' },
    },
    devices: {
      type: 'json',
      description: 'Available playback devices',
      condition: { field: 'operation', value: 'spotify_get_devices' },
    },
    progress_ms: {
      type: 'number',
      description: 'Current playback position in ms',
      condition: {
        field: 'operation',
        value: ['spotify_get_playback_state', 'spotify_get_currently_playing'],
      },
    },
    currently_playing_type: {
      type: 'string',
      description: 'Type of content (track, episode, ad)',
      condition: { field: 'operation', value: 'spotify_get_playback_state' },
    },
    shuffle_state: {
      type: 'boolean',
      description: 'Whether shuffle is enabled',
      condition: { field: 'operation', value: 'spotify_get_playback_state' },
    },
    repeat_state: {
      type: 'string',
      description: 'Repeat mode (off, track, context)',
      condition: { field: 'operation', value: 'spotify_get_playback_state' },
    },
    track: {
      type: 'json',
      description: 'Currently playing track',
      condition: {
        field: 'operation',
        value: ['spotify_get_playback_state', 'spotify_get_currently_playing'],
      },
    },
    currently_playing: {
      type: 'json',
      description: 'Currently playing item',
      condition: { field: 'operation', value: 'spotify_get_queue' },
    },
    queue: {
      type: 'json',
      description: 'Upcoming tracks in queue',
      condition: { field: 'operation', value: 'spotify_get_queue' },
    },

    // === RECENTLY PLAYED OUTPUTS ===
    items: {
      type: 'json',
      description: 'List of recently played items',
      condition: { field: 'operation', value: 'spotify_get_recently_played' },
    },

    // === BROWSE OUTPUTS ===
    categories: {
      type: 'json',
      description: 'List of browse categories',
      condition: { field: 'operation', value: 'spotify_get_categories' },
    },
    markets: {
      type: 'json',
      description: 'List of available market codes',
      condition: { field: 'operation', value: 'spotify_get_markets' },
    },

    // === CHECK SAVED OUTPUTS ===
    results: {
      type: 'json',
      description: 'Check operation results (id and saved boolean)',
      condition: {
        field: 'operation',
        value: [
          'spotify_check_saved_tracks',
          'spotify_check_saved_albums',
          'spotify_check_saved_shows',
          'spotify_check_saved_episodes',
          'spotify_check_saved_audiobooks',
          'spotify_check_following',
          'spotify_check_playlist_followers',
        ],
      },
    },
    all_saved: {
      type: 'boolean',
      description: 'Whether all tracks are saved',
      condition: { field: 'operation', value: 'spotify_check_saved_tracks' },
    },
    none_saved: {
      type: 'boolean',
      description: 'Whether no tracks are saved',
      condition: { field: 'operation', value: 'spotify_check_saved_tracks' },
    },

    // === PAGINATION OUTPUTS ===
    total: {
      type: 'number',
      description: 'Total number of items',
      condition: {
        field: 'operation',
        value: [
          'spotify_get_album_tracks',
          'spotify_get_artist_albums',
          'spotify_get_playlist_tracks',
          'spotify_get_user_playlists',
          'spotify_get_saved_tracks',
          'spotify_get_saved_albums',
          'spotify_get_top_tracks',
          'spotify_get_top_artists',
          'spotify_get_new_releases',
          'spotify_get_categories',
        ],
      },
    },
    next: {
      type: 'string',
      description: 'URL for next page of results',
      condition: {
        field: 'operation',
        value: [
          'spotify_get_album_tracks',
          'spotify_get_artist_albums',
          'spotify_get_playlist_tracks',
          'spotify_get_user_playlists',
          'spotify_get_saved_tracks',
          'spotify_get_saved_albums',
          'spotify_get_top_tracks',
          'spotify_get_top_artists',
          'spotify_get_recently_played',
          'spotify_get_new_releases',
        ],
      },
    },

    // === OPERATION RESULT OUTPUTS ===
    success: {
      type: 'boolean',
      description: 'Whether operation succeeded',
      condition: {
        field: 'operation',
        value: [
          'spotify_play',
          'spotify_pause',
          'spotify_skip_next',
          'spotify_skip_previous',
          'spotify_seek',
          'spotify_set_volume',
          'spotify_set_repeat',
          'spotify_set_shuffle',
          'spotify_transfer_playback',
          'spotify_add_to_queue',
          'spotify_save_tracks',
          'spotify_remove_saved_tracks',
          'spotify_save_albums',
          'spotify_remove_saved_albums',
          'spotify_save_shows',
          'spotify_remove_saved_shows',
          'spotify_save_episodes',
          'spotify_remove_saved_episodes',
          'spotify_save_audiobooks',
          'spotify_remove_saved_audiobooks',
          'spotify_follow_artists',
          'spotify_unfollow_artists',
          'spotify_follow_playlist',
          'spotify_unfollow_playlist',
          'spotify_update_playlist',
          'spotify_add_playlist_cover',
        ],
      },
    },
  },
}
