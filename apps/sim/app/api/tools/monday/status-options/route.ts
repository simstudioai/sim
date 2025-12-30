import { NextResponse } from 'next/server'
import { createLogger } from '@sim/logger'
import { generateRequestId } from '@/lib/core/utils/request'
import { executeMondayQuery, QUERIES } from '@/tools/monday/graphql'

export const dynamic = 'force-dynamic'

const logger = createLogger('MondayStatusOptionsAPI')

interface MondayColumn {
  id: string
  title: string
  type: string
  settings_str?: string
}

interface StatusLabel {
  id: string
  label: string
  color: string
}

export async function POST(request: Request) {
  try {
    const requestId = generateRequestId()
    const body = await request.json()
    const { apiKey, boardId, columnId } = body

    if (!apiKey || !boardId || !columnId) {
      return NextResponse.json(
        { error: 'API key, board ID, and column ID are required' },
        { status: 400 }
      )
    }

    logger.info('Fetching Monday.com status options', { requestId, boardId, columnId })

    const data = await executeMondayQuery<{ boards: Array<{ columns: MondayColumn[] }> }>(
      apiKey,
      {
        query: QUERIES.GET_COLUMN_SETTINGS,
        variables: {
          boardId: [parseInt(boardId, 10)],
          columnId,
        },
      }
    )

    const column = data.boards?.[0]?.columns?.[0]

    if (!column) {
      return NextResponse.json({ error: 'Column not found' }, { status: 404 })
    }

    if (column.type !== 'status' && column.type !== 'color') {
      return NextResponse.json(
        { error: `Column type ${column.type} does not have status options` },
        { status: 400 }
      )
    }

    let statusOptions: StatusLabel[] = []

    if (column.settings_str) {
      try {
        const settings = JSON.parse(column.settings_str)
        const labels = settings.labels || {}

        statusOptions = Object.entries(labels).map(([id, label]: [string, any]) => ({
          id,
          label: label.label || label,
          color: label.color || '#000000',
        }))
      } catch (parseError) {
        logger.error('Failed to parse column settings', {
          error: parseError,
          settings_str: column.settings_str,
        })
      }
    }

    logger.info(`Successfully fetched ${statusOptions.length} status options`, { requestId })
    return NextResponse.json({
      items: statusOptions.map((option) => ({
        id: option.id,
        name: option.label,
        color: option.color,
      })),
    })
  } catch (error) {
    logger.error('Error fetching Monday.com status options:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve status options', details: (error as Error).message },
      { status: 500 }
    )
  }
}
