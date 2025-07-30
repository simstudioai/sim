import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'

interface DiscordChannel {
  id: string
  name: string
  type: number
  guild_id?: string
}

export const dynamic = 'force-dynamic'

const logger = createLogger('DiscordChannelsAPI')

export async function POST(request: Request) {
  try {
    const { botToken, serverId, channelId } = await request.json()

    if (!botToken) {
      logger.error('Missing bot token in request')
      return NextResponse.json({ error: 'Bot token is required' }, { status: 400 })
    }

    if (!serverId) {
      logger.error('Missing server ID in request')
      return NextResponse.json({ error: 'Server ID is required' }, { status: 400 })
    }

    // If channelId is provided, we'll fetch just that specific channel
    if (channelId) {
      logger.info(`Fetching single Discord channel: ${channelId}`)

      // Fetch a specific channel by ID
      const response = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        logger.error('Discord API error fetching channel:', {
          status: response.status,
          statusText: response.statusText,
        })

        let errorMessage
        try {
          const errorData = await response.json()
          logger.error('Error details:', errorData)
          errorMessage = errorData.message || `Failed to fetch channel (${response.status})`
        } catch (_e) {
          errorMessage = `Failed to fetch channel: ${response.status} ${response.statusText}`
        }
        return NextResponse.json({ error: errorMessage }, { status: response.status })
      }

      const channel = (await response.json()) as DiscordChannel

      // Verify this is a text channel and belongs to the requested server
      if (channel.guild_id !== serverId) {
        logger.error('Channel does not belong to the specified server')
        return NextResponse.json(
          { error: 'Channel not found in specified server' },
          { status: 404 }
        )
      }

      if (channel.type !== 0) {
        logger.warn('Requested channel is not a text channel')
        return NextResponse.json({ error: 'Channel is not a text channel' }, { status: 400 })
      }

      logger.info(`Successfully fetched channel: ${channel.name}`)

      return NextResponse.json({
        channel: {
          id: channel.id,
          name: channel.name,
          type: channel.type,
        },
      })
    }

    logger.info(`Fetching all Discord channels for server: ${serverId}`)

    // Fetch all channels from Discord API
    const response = await fetch(`https://discord.com/api/v10/guilds/${serverId}/channels`, {
      method: 'GET',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      logger.error('Discord API error:', {
        status: response.status,
        statusText: response.statusText,
      })

      let errorMessage
      try {
        const errorData = await response.json()
        logger.error('Error details:', errorData)
        errorMessage = errorData.message || `Failed to fetch channels (${response.status})`
      } catch (_e) {
        errorMessage = `Failed to fetch channels: ${response.status} ${response.statusText}`
      }
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const channels = (await response.json()) as DiscordChannel[]

    // Filter to just text channels (type 0)
    const textChannels = channels.filter((channel: DiscordChannel) => channel.type === 0)

    logger.info(`Successfully fetched ${textChannels.length} text channels`)

    return NextResponse.json({
      channels: textChannels.map((channel: DiscordChannel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
      })),
    })
  } catch (error) {
    logger.error('Error processing request:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve Discord channels',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
}
