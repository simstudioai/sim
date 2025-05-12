import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'

interface DiscordServer {
  id: string
  name: string
  icon: string | null
}

const logger = createLogger('DiscordServersAPI')

export async function POST(request: Request) {
  try {
    const { botToken, serverId } = await request.json()

    if (!botToken) {
      logger.error('Missing bot token in request')
      return NextResponse.json({ error: 'Bot token is required' }, { status: 400 })
    }

    // If serverId is provided, we'll fetch just that server
    if (serverId) {
      logger.info(`Fetching single Discord server: ${serverId}`)

      // Fetch a specific server by ID
      const response = await fetch(`https://discord.com/api/v10/guilds/${serverId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        logger.error('Discord API error fetching server:', {
          status: response.status,
          statusText: response.statusText,
        })

        let errorMessage
        try {
          const errorData = await response.json()
          logger.error('Error details:', errorData)
          errorMessage = errorData.message || `Failed to fetch server (${response.status})`
        } catch (e) {
          errorMessage = `Failed to fetch server: ${response.status} ${response.statusText}`
        }
        return NextResponse.json({ error: errorMessage }, { status: response.status })
      }

      const server = (await response.json()) as DiscordServer
      logger.info(`Successfully fetched server: ${server.name}`)

      return NextResponse.json({
        server: {
          id: server.id,
          name: server.name,
          icon: server.icon
            ? `https://cdn.discordapp.com/icons/${server.id}/${server.icon}.png`
            : null,
        },
      })
    }

    // Otherwise, fetch all servers the bot is in
    logger.info('Fetching all Discord servers')

    const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
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
        errorMessage = errorData.message || `Failed to fetch servers (${response.status})`
      } catch (e) {
        errorMessage = `Failed to fetch servers: ${response.status} ${response.statusText}`
      }
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const servers = (await response.json()) as DiscordServer[]
    logger.info(`Successfully fetched ${servers.length} servers`)

    return NextResponse.json({
      servers: servers.map((server: DiscordServer) => ({
        id: server.id,
        name: server.name,
        icon: server.icon
          ? `https://cdn.discordapp.com/icons/${server.id}/${server.icon}.png`
          : null,
      })),
    })
  } catch (error) {
    logger.error('Error processing request:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve Discord servers',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
}
