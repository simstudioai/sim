import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

const logger = createLogger('MeshThreadDetailAPI')

const MESH_BUS_URL = process.env.MESH_BUS_URL || 'http://100.64.0.1:8787'

export interface MeshMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  agentId?: string
  agentName?: string
  agentColor?: string
  content: string
  timestamp: string
  metadata?: Record<string, unknown>
}

export interface MeshThreadDetail {
  contextId: string
  title: string
  agents: Array<{
    id: string
    name: string
    node: string
    color: string
  }>
  status: 'active' | 'completed' | 'failed'
  turnCount: number
  messages: MeshMessage[]
  createdAt: string
  updatedAt: string
}

/**
 * GET /api/mesh/threads/[contextId] - Fetch a single mesh thread with messages.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ contextId: string }> }
) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { contextId } = await params

  try {
    const meshResponse = await fetch(
      `${MESH_BUS_URL}/api/v1/mesh/threads/${contextId}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': session.user.id,
        },
      }
    )

    if (!meshResponse.ok) {
      logger.error('Mesh bus thread detail request failed', {
        contextId,
        status: meshResponse.status,
      })
      return NextResponse.json(
        { error: 'Failed to fetch mesh thread' },
        { status: meshResponse.status }
      )
    }

    const data: MeshThreadDetail = await meshResponse.json()
    return NextResponse.json(data)
  } catch (error) {
    logger.error('Error fetching mesh thread detail', { contextId, error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
