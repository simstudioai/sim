import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { validateNumericId } from '@/lib/security/input-validation'

interface DiscordServer {
  id: string
  name: string
  icon: string | null
}

export const dynamic = 'force-dynamic'

const logger = createLogger('DiscordServersAPI')

export async function POST(request: Request) {
  try {
    const { botToken, serverId } = await request.json()

    if (!botToken) {
      logger.error('Missing bot token in request')
      return NextResponse.json({ error: 'Bot token is required' }, { status: 400 })
    }

    if (serverId) {
      const serverIdValidation = validateNumericId(serverId, 'serverId')
      if (!serverIdValidation.isValid) {
        logger.error(`Invalid server ID: ${serverIdValidation.error}`)
        return NextResponse.json({ error: serverIdValidation.error }, { status: 400 })
      }

      logger.info(`Fetching single Discord server: ${serverId}`)

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
        } catch (_e) {
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

    logger.info(
      'Skipping guild listing: bot token cannot list /users/@me/guilds; returning empty list'
    )
    return NextResponse.json({ servers: [] })
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
