import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { QUERIES } from '@/tools/monday/graphql'

const logger = createLogger('MondayItemsAPI')

interface MondayItem {
  id: string
  name: string
}

/**
 * POST /api/tools/monday/items
 * Fetches items from a Monday.com board for selector dropdown
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { apiKey, boardId } = body

    if (!apiKey) {
      logger.warn('Missing apiKey in request')
      return NextResponse.json({ error: 'API key is required' }, { status: 400 })
    }

    if (!boardId) {
      logger.warn('Missing boardId in request')
      return NextResponse.json({ error: 'Board ID is required' }, { status: 400 })
    }

    logger.info('Fetching Monday.com items', { boardId })

    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
        'API-Version': '2024-01',
      },
      body: JSON.stringify({
        query: QUERIES.GET_BOARD_ITEMS,
        variables: {
          boardId: [parseInt(boardId, 10)],
          limit: 100,
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Monday.com API error', {
        status: response.status,
        error: errorText,
      })
      return NextResponse.json(
        { error: `Monday.com API error: ${response.status}` },
        { status: response.status }
      )
    }

    const result = await response.json()

    if (result.errors) {
      logger.error('Monday.com GraphQL errors', { errors: result.errors })
      return NextResponse.json(
        { error: 'Failed to fetch items', details: result.errors },
        { status: 400 }
      )
    }

    const items = result.data?.boards?.[0]?.items_page?.items || []

    logger.info('Successfully fetched Monday.com items', { count: items.length })

    return NextResponse.json({
      items: items.map((item: MondayItem) => ({
        id: item.id,
        name: item.name,
      })),
    })
  } catch (error) {
    logger.error('Unexpected error fetching Monday.com items', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
