import { NextResponse } from 'next/server'
import { createLogger } from '@sim/logger'
import { generateRequestId } from '@/lib/core/utils/request'
import { executeMondayQuery, QUERIES } from '@/tools/monday/graphql'

export const dynamic = 'force-dynamic'

const logger = createLogger('MondayGroupsAPI')

interface MondayGroup {
  id: string
  title: string
  color: string
}

export async function POST(request: Request) {
  try {
    const requestId = generateRequestId()
    const body = await request.json()
    const { apiKey, boardId } = body

    if (!apiKey || !boardId) {
      return NextResponse.json(
        { error: 'API key and board ID are required' },
        { status: 400 }
      )
    }

    logger.info('Fetching Monday.com groups', { requestId, boardId })

    const data = await executeMondayQuery<{ boards: Array<{ groups: MondayGroup[] }> }>(
      apiKey,
      {
        query: QUERIES.GET_BOARD_GROUPS,
        variables: { boardId: [parseInt(boardId, 10)] },
      }
    )

    const groups = data.boards?.[0]?.groups || []
    const formattedGroups = groups.map((group) => ({
      id: group.id,
      name: group.title,
      color: group.color,
    }))

    logger.info(`Successfully fetched ${formattedGroups.length} groups`, { requestId })
    return NextResponse.json({ items: formattedGroups })
  } catch (error) {
    logger.error('Error fetching Monday.com groups:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve groups', details: (error as Error).message },
      { status: 500 }
    )
  }
}
