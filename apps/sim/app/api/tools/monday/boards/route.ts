import { NextResponse } from 'next/server'
import { createLogger } from '@sim/logger'
import { generateRequestId } from '@/lib/core/utils/request'
import { executeMondayQuery, QUERIES } from '@/tools/monday/graphql'

export const dynamic = 'force-dynamic'

const logger = createLogger('MondayBoardsAPI')

interface MondayBoard {
  id: string
  name: string
  description?: string
  board_kind: string
  state: string
}

/**
 * POST /api/tools/monday/boards
 * Fetches active boards from a Monday.com account
 *
 * @param request - Request containing the Monday.com API key
 * @returns JSON response with list of active boards
 */
export async function POST(request: Request) {
  try {
    const requestId = generateRequestId()
    const body = await request.json()
    const { apiKey } = body

    if (!apiKey) {
      logger.error('Missing API key in request')
      return NextResponse.json({ error: 'API key is required' }, { status: 400 })
    }

    logger.info('Fetching Monday.com boards', { requestId })

    const data = await executeMondayQuery<{ boards: MondayBoard[] }>(apiKey, {
      query: QUERIES.GET_BOARDS,
    })

    const boards = (data.boards || [])
      .filter((board) => board.state === 'active')
      .map((board) => ({
        id: board.id,
        name: board.name,
        description: board.description,
        kind: board.board_kind,
      }))

    logger.info(`Successfully fetched ${boards.length} Monday.com boards`, { requestId })
    return NextResponse.json({ items: boards })
  } catch (error) {
    logger.error('Error fetching Monday.com boards:', error)
    return NextResponse.json({ error: 'Failed to retrieve Monday.com boards' }, { status: 500 })
  }
}
