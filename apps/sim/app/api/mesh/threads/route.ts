import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

const logger = createLogger('MeshThreadsAPI')

const MESH_BUS_URL = process.env.MESH_BUS_URL || 'http://100.64.0.1:8787'

export interface MeshThread {
  contextId: string
  title: string
  agents: MeshAgent[]
  status: 'active' | 'completed' | 'failed'
  turnCount: number
  createdAt: string
  updatedAt: string
}

export interface MeshAgent {
  id: string
  name: string
  node: string
  color: string
}

export interface MeshThreadsResponse {
  threads: MeshThread[]
  total: number
}

/**
 * GET /api/mesh/threads - List all mesh conversation threads.
 * Proxies to the Atlas Mesh Bus and filters by thread title prefix.
 */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const limit = searchParams.get('limit') || '50'
    const offset = searchParams.get('offset') || '0'

    const meshResponse = await fetch(
      `${MESH_BUS_URL}/api/v1/mesh/threads?limit=${limit}&offset=${offset}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': session.user.id,
        },
      }
    )

    if (!meshResponse.ok) {
      logger.error('Mesh bus request failed', {
        status: meshResponse.status,
        statusText: meshResponse.statusText,
      })
      return NextResponse.json(
        { error: 'Failed to fetch mesh threads' },
        { status: meshResponse.status }
      )
    }

    const data: MeshThreadsResponse = await meshResponse.json()
    return NextResponse.json(data)
  } catch (error) {
    logger.error('Error fetching mesh threads', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
