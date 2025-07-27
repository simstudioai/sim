import { type NextRequest, NextResponse } from 'next/server'
import { WORKFLOW_EXAMPLES } from '../../../../lib/copilot/examples'

export async function POST(request: NextRequest) {
  try {
    console.log('[get-workflow-examples] API endpoint called')

    const body = await request.json()
    const { exampleIds } = body

    if (!Array.isArray(exampleIds)) {
      return NextResponse.json(
        {
          success: false,
          error: 'exampleIds must be an array',
        },
        { status: 400 }
      )
    }

    const examples: Record<string, string> = {}
    const notFound: string[] = []

    for (const id of exampleIds) {
      if (WORKFLOW_EXAMPLES[id]) {
        examples[id] = WORKFLOW_EXAMPLES[id]
      } else {
        notFound.push(id)
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        examples,
        notFound,
        availableIds: Object.keys(WORKFLOW_EXAMPLES),
      },
    })
  } catch (error) {
    console.error('[get-workflow-examples] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get workflow examples',
      },
      { status: 500 }
    )
  }
}
