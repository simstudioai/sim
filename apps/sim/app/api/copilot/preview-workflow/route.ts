import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('PreviewWorkflowAPI')

export async function POST(request: NextRequest) {
  try {
    // Check authentication (session, API key, or internal JWT)
    const authResult = await checkHybridAuth(request)
    if (!authResult.success) {
      return NextResponse.json(
        { success: false, error: authResult.error },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { yamlContent, description } = body

    if (!yamlContent) {
      return NextResponse.json(
        { success: false, error: 'yamlContent is required' },
        { status: 400 }
      )
    }

    logger.info('Generating workflow preview for copilot', { 
      yamlLength: yamlContent.length,
      description,
      authType: authResult.authType,
      userId: authResult.userId
    })

    // Forward the request to the existing workflow preview endpoint
    const previewUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/workflows/preview`
    
    const response = await fetch(previewUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        yamlContent,
        applyAutoLayout: true,
      }),
    })

    if (!response.ok) {
      logger.error('Workflow preview API failed', { 
        status: response.status, 
        statusText: response.statusText 
      })
      return NextResponse.json(
        { success: false, error: 'Workflow preview generation failed' },
        { status: response.status }
      )
    }

    const previewData = await response.json()

    if (!previewData.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Preview generation failed: ${previewData.message || 'Unknown error'}` 
        },
        { status: 400 }
      )
    }

    // Return in the format expected by the copilot for diff functionality
    return NextResponse.json({
      success: true,
      data: {
        ...previewData,
        yamlContent, // Include the original YAML for diff functionality
        description,
      },
    })
  } catch (error) {
    logger.error('Preview workflow API failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: `Preview workflow failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
} 