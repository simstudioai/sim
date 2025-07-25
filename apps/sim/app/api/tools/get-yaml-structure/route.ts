import { type NextRequest, NextResponse } from 'next/server'
import { getYamlWorkflowPrompt } from '@/lib/copilot/prompts'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    console.log('[get-yaml-structure] API endpoint called')

    return NextResponse.json({
      success: true,
      data: {
        guide: getYamlWorkflowPrompt(),
        message: 'Complete YAML workflow syntax guide with examples and best practices',
      },
    })
  } catch (error) {
    console.error('[get-yaml-structure] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get YAML structure',
      },
      { status: 500 }
    )
  }
}
