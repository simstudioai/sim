import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { agentChat, agent } from '@/db/schema'
import { and, eq, desc } from 'drizzle-orm'

// GET: Retrieve all chats for a specific agent
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const url = new URL(request.url)
    const agentId = url.searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 })
    }

    // Check if agent belongs to user
    const [agentExists] = await db
      .select()
      .from(agent)
      .where(and(eq(agent.id, agentId), eq(agent.userId, userId)))
      .limit(1)

    if (!agentExists) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // Get all chats for this agent
    const chats = await db
      .select()
      .from(agentChat)
      .where(and(eq(agentChat.agentId, agentId), eq(agentChat.userId, userId)))
      .orderBy(desc(agentChat.updatedAt))

    return NextResponse.json(chats)
  } catch (error) {
    console.error('Error fetching agent chats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch agent chats' },
      { status: 500 }
    )
  }
}

// POST: Create a new chat for an agent
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const { agentId, title } = await request.json()

    if (!agentId) {
      return NextResponse.json(
        { error: 'Agent ID is required' },
        { status: 400 }
      )
    }

    // Check if agent belongs to user
    const [agentExists] = await db
      .select()
      .from(agent)
      .where(and(eq(agent.id, agentId), eq(agent.userId, userId)))
      .limit(1)

    if (!agentExists) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // Create new chat
    const [newChat] = await db
      .insert(agentChat)
      .values({
        id: `chat-${Date.now()}`,
        agentId,
        userId,
        title: title || `Chat ${new Date().toLocaleString()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    return NextResponse.json(newChat)
  } catch (error) {
    console.error('Error creating agent chat:', error)
    return NextResponse.json(
      { error: 'Failed to create agent chat' },
      { status: 500 }
    )
  }
} 