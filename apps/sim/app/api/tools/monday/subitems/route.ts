import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { QUERIES } from '@/tools/monday/graphql'

const logger = createLogger('MondaySubitemsAPI')

interface MondaySubitem {
  id: string
  name: string
}

/**
 * POST /api/tools/monday/subitems
 * Fetches subitems from a Monday.com item for selector dropdown
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { apiKey, itemId } = body

    if (!apiKey) {
      logger.warn('Missing apiKey in request')
      return NextResponse.json({ error: 'API key is required' }, { status: 400 })
    }

    if (!itemId) {
      logger.warn('Missing itemId in request')
      return NextResponse.json({ error: 'Item ID is required' }, { status: 400 })
    }

    logger.info('Fetching Monday.com subitems', { itemId })

    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
        'API-Version': '2024-01',
      },
      body: JSON.stringify({
        query: QUERIES.GET_ITEM_SUBITEMS,
        variables: {
          itemId: [parseInt(itemId, 10)],
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
        { error: 'Failed to fetch subitems', details: result.errors },
        { status: 400 }
      )
    }

    const subitems = result.data?.items?.[0]?.subitems || []

    logger.info('Successfully fetched Monday.com subitems', { count: subitems.length })

    return NextResponse.json({
      items: subitems.map((subitem: MondaySubitem) => ({
        id: subitem.id,
        name: subitem.name,
      })),
    })
  } catch (error) {
    logger.error('Unexpected error fetching Monday.com subitems', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
