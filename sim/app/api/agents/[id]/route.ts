import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { agent } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

// GET: Retrieve a specific agent
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const agentId = await params.id

    const [selectedAgent] = await db
      .select()
      .from(agent)
      .where(and(eq(agent.id, agentId), eq(agent.userId, userId)))
      .limit(1)

    if (!selectedAgent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    return NextResponse.json(selectedAgent)
  } catch (error) {
    console.error('Error fetching agent:', error)
    return NextResponse.json(
      { error: 'Failed to fetch agent' },
      { status: 500 }
    )
  }
}

// PUT: Update an existing agent
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const agentId = params.id
    const { name, description, config, isDefault } = await request.json()

    // Verify the agent belongs to the user
    const [existingAgent] = await db
      .select()
      .from(agent)
      .where(and(eq(agent.id, agentId), eq(agent.userId, userId)))
      .limit(1)

    if (!existingAgent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // Update the agent
    const [updatedAgent] = await db
      .update(agent)
      .set({
        name: name ?? existingAgent.name,
        description: description ?? existingAgent.description,
        config: config ?? existingAgent.config,
        isDefault: isDefault ?? existingAgent.isDefault,
        updatedAt: new Date(),
      })
      .where(and(eq(agent.id, agentId), eq(agent.userId, userId)))
      .returning()

    return NextResponse.json(updatedAgent)
  } catch (error) {
    console.error('Error updating agent:', error)
    return NextResponse.json(
      { error: 'Failed to update agent' },
      { status: 500 }
    )
  }
}

// DELETE: Delete an agent
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const agentId = params.id

    // Verify the agent belongs to the user
    const [existingAgent] = await db
      .select()
      .from(agent)
      .where(and(eq(agent.id, agentId), eq(agent.userId, userId)))
      .limit(1)

    if (!existingAgent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // Delete the agent
    await db
      .delete(agent)
      .where(and(eq(agent.id, agentId), eq(agent.userId, userId)))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting agent:', error)
    return NextResponse.json(
      { error: 'Failed to delete agent' },
      { status: 500 }
    )
  }
} 