import { type NextRequest, NextResponse } from 'next/server'
import { YAML_WORKFLOW_PROMPT } from '../../../../lib/copilot/prompts'

export async function POST(request: NextRequest) {
  try {
    console.log('[get-yaml-structure] API endpoint called')

    return NextResponse.json({
      success: true,
      data: {
        guide: YAML_WORKFLOW_PROMPT,
        message: 'Complete YAML workflow syntax guide with examples and best practices',
      },
    })
  } catch (error) {
    console.error('[get-yaml-structure] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get YAML structure guide',
      },
      { status: 500 }
    )
  }
}
