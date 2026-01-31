import type { SpotifyGetDevicesParams, SpotifyGetDevicesResponse } from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyGetDevicesTool: ToolConfig<SpotifyGetDevicesParams, SpotifyGetDevicesResponse> =
  {
    id: 'spotify_get_devices',
    name: 'Spotify Get Devices',
    description: "Get the user's available Spotify playback devices.",
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'spotify',
      requiredScopes: ['user-read-playback-state'],
    },

    params: {},

    request: {
      url: () => 'https://api.spotify.com/v1/me/player/devices',
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response): Promise<SpotifyGetDevicesResponse> => {
      const data = await response.json()

      const devices = (data.devices || []).map((device: any) => ({
        id: device.id,
        is_active: device.is_active,
        is_private_session: device.is_private_session,
        is_restricted: device.is_restricted,
        name: device.name,
        type: device.type,
        volume_percent: device.volume_percent,
      }))

      return {
        success: true,
        output: {
          devices,
        },
      }
    },

    outputs: {
      devices: {
        type: 'array',
        description: 'Available playback devices',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Device ID' },
            is_active: { type: 'boolean', description: 'Whether device is active' },
            is_private_session: { type: 'boolean', description: 'Whether in private session' },
            is_restricted: { type: 'boolean', description: 'Whether device is restricted' },
            name: { type: 'string', description: 'Device name' },
            type: { type: 'string', description: 'Device type (Computer, Smartphone, etc.)' },
            volume_percent: { type: 'number', description: 'Current volume (0-100)' },
          },
        },
      },
    },
  }
