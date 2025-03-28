import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { agentChat, agentChatMessage } from '@/db/schema'
import { and, eq, count, max } from 'drizzle-orm'

// POST: Add a new message to the chat
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const chatId = params.id
    const { role, content, toolCallData } = await request.json()

    if (!role) {
      return NextResponse.json(
        { error: 'Role is required' },
        { status: 400 }
      )
    }

    // Verify the chat belongs to the user
    const [chat] = await db
      .select()
      .from(agentChat)
      .where(and(eq(agentChat.id, chatId), eq(agentChat.userId, userId)))
      .limit(1)

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Get the highest message order to add this message at the end
    const [orderResult] = await db
      .select({ maxOrder: max(agentChatMessage.order) })
      .from(agentChatMessage)
      .where(eq(agentChatMessage.chatId, chatId))

    const nextOrder = (orderResult?.maxOrder ?? -1) + 1

    // Insert the new message
    const [newMessage] = await db
      .insert(agentChatMessage)
      .values({
        id: `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        chatId,
        role,
        content,
        toolCallData: toolCallData || null,
        createdAt: new Date(),
        order: nextOrder,
      })
      .returning()

    // Update the chat's updatedAt timestamp
    await db
      .update(agentChat)
      .set({ updatedAt: new Date() })
      .where(eq(agentChat.id, chatId))

    return NextResponse.json(newMessage)
  } catch (error) {
    console.error('Error adding message:', error)
    return NextResponse.json(
      { error: 'Failed to add message' },
      { status: 500 }
    )
  }
}

// DELETE: Delete all messages for a chat
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
    const chatId = params.id

    // Verify the chat belongs to the user
    const [chat] = await db
      .select()
      .from(agentChat)
      .where(and(eq(agentChat.id, chatId), eq(agentChat.userId, userId)))
      .limit(1)

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Delete all messages for this chat
    await db
      .delete(agentChatMessage)
      .where(eq(agentChatMessage.chatId, chatId))

    // Update the chat's updatedAt timestamp
    await db
      .update(agentChat)
      .set({ updatedAt: new Date() })
      .where(eq(agentChat.id, chatId))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting messages:', error)
    return NextResponse.json(
      { error: 'Failed to delete messages' },
      { status: 500 }
    )
  }
} 