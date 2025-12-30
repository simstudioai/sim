import { NextResponse } from 'next/server'
import { createLogger } from '@sim/logger'
import { generateRequestId } from '@/lib/core/utils/request'
import { executeMondayQuery, QUERIES } from '@/tools/monday/graphql'

export const dynamic = 'force-dynamic'

const logger = createLogger('MondayColumnsAPI')

interface MondayColumn {
  id: string
  title: string
  type: string
  settings_str?: string
}

export async function POST(request: Request) {
  try {
    const requestId = generateRequestId()
    const body = await request.json()
    const { apiKey, boardId } = body

    if (!apiKey) {
      logger.error('Missing API key in request')
      return NextResponse.json({ error: 'API key is required' }, { status: 400 })
    }

    if (!boardId) {
      logger.error('Missing board ID in request')
      return NextResponse.json({ error: 'Board ID is required' }, { status: 400 })
    }

    const parsedBoardId = parseInt(boardId, 10)
    if (isNaN(parsedBoardId)) {
      logger.error('Invalid board ID format', { boardId })
      return NextResponse.json({ error: 'Board ID must be a valid number' }, { status: 400 })
    }

    logger.info('Fetching Monday.com columns', { requestId, boardId: parsedBoardId })

    const data = await executeMondayQuery<{ boards: Array<{ columns: MondayColumn[] }> }>(
      apiKey,
      {
        query: QUERIES.GET_BOARD_COLUMNS,
        variables: { boardId: [parsedBoardId] },
      }
    )

    const columns = data.boards?.[0]?.columns || []
    const formattedColumns = columns.map((col) => ({
      id: col.id,
      name: col.title,
      type: col.type,
    }))

    logger.info(`Successfully fetched ${formattedColumns.length} columns`, { requestId })
    return NextResponse.json({ items: formattedColumns })
  } catch (error) {
    logger.error('Error fetching Monday.com columns:', error)
    return NextResponse.json({ error: 'Failed to retrieve columns' }, { status: 500 })
  }
}
