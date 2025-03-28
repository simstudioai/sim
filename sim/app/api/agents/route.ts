import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { agent } from '@/db/schema'
import { eq } from 'drizzle-orm'

// GET: Retrieve all agents for the current user
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const agents = await db.select().from(agent)
      .where(eq(agent.userId, userId))
      .orderBy(agent.createdAt)

    return NextResponse.json(agents)
  } catch (error) {
    console.error('Error fetching agents:', error)
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    )
  }
}

// POST: Create a new agent
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const { name, description, config, isDefault = false } = await request.json()

    if (!name) {
      return NextResponse.json(
        { error: 'Agent name is required' },
        { status: 400 }
      )
    }

    const newAgent = await db.insert(agent).values({
      id: `agent-${Date.now()}`,
      userId,
      name,
      description,
      config,
      isDefault,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning()

    return NextResponse.json(newAgent[0])
  } catch (error) {
    console.error('Error creating agent:', error)
    return NextResponse.json(
      { error: 'Failed to create agent' },
      { status: 500 }
    )
  }
} 