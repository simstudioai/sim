import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('SetEnvironmentVariablesAPI')

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

    // Ensure we have a user ID for this operation
    if (!authResult.userId) {
      return NextResponse.json(
        { success: false, error: 'User ID required for environment variables access' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { variables } = body

    if (!variables || typeof variables !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Variables object is required' },
        { status: 400 }
      )
    }

    logger.info('Setting environment variables for copilot', { 
      variableCount: Object.keys(variables).length,
      variableNames: Object.keys(variables),
      authType: authResult.authType,
      userId: authResult.userId
    })

    // Forward the request to the existing environment variables endpoint
    const envUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/environment/variables`
    
    // Create headers for the forwarded request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Forward authentication based on the original auth method
    if (authResult.authType === 'api_key') {
      const apiKeyHeader = request.headers.get('x-api-key')
      if (apiKeyHeader) {
        headers['X-API-Key'] = apiKeyHeader
      }
    } else if (authResult.authType === 'internal_jwt') {
      const authHeader = request.headers.get('authorization')
      if (authHeader) {
        headers['Authorization'] = authHeader
      }
    } else {
      // For session auth, copy the cookies
      const cookieHeader = request.headers.get('cookie')
      if (cookieHeader) {
        headers['Cookie'] = cookieHeader
      }
    }
    
    const response = await fetch(envUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ variables }),
    })

    if (!response.ok) {
      logger.error('Set environment variables API failed', { 
        status: response.status, 
        statusText: response.statusText 
      })
      return NextResponse.json(
        { success: false, error: 'Failed to set environment variables' },
        { status: response.status }
      )
    }

    const result = await response.json()

    return NextResponse.json({
      success: true,
      data: {
        message: 'Environment variables updated successfully',
        updatedVariables: Object.keys(variables),
        count: Object.keys(variables).length,
      },
    })
  } catch (error) {
    logger.error('Set environment variables API failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: `Failed to set environment variables: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
} 